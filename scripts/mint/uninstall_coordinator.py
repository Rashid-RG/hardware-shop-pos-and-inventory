"""Internal staged uninstall rehearsal; never removes software or data."""
import importlib.util
import os
from pathlib import Path
import subprocess
import re

from uninstall_shutdown import shutdown, CONFIRMATION, STATE
from uninstall_final_review import _inspect as inspect_final, FLAGS
from maintenance_backup import stopped
from repair_interruption import read_regular
from uninstall_cancellation import validate, CONFIRMATION as CANCEL_CONFIRMATION
import json


def rehearse(confirmation):
    if confirmation != CONFIRMATION or os.geteuid() == 0:
        raise ValueError("Explicit desktop-user shutdown approval required.")
    # Keep the maintenance lock across the staged rehearsal after shutdown.
    proof = shutdown(confirmation)
    uid = proof["uninstallId"]
    if not re.fullmatch(r"[a-f0-9]{32}", uid):
        raise ValueError("Invalid uninstall identity.")
    project = (STATE / "project").resolve(strict=True)
    hold_path = STATE / "maintenance-hold.json"
    proof_path = STATE / "uninstall-shutdown.json"
    hold_raw = read_regular(hold_path)
    proof_raw = read_regular(proof_path)
    hold = json.loads(hold_raw)
    if hold["uninstallId"] != uid or json.loads(proof_raw) != proof:
        raise ValueError("Shutdown identity changed.")
    def check():
        if read_regular(hold_path) != hold_raw or read_regular(proof_path) != proof_raw or (STATE / "project").resolve(strict=True) != project:
            raise ValueError("Maintenance evidence changed.")
        validate(hold_raw, proof_raw, project, CANCEL_CONFIRMATION)
        stopped()
    check()
    folder = STATE / "uninstall-recovery" / uid
    # The backup child retains the update lock while the parent holds maintenance.
    import fcntl
    from resume_maintenance import open_lock
    with open_lock(STATE / "maintenance.lock") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        check()
        outcome = subprocess.run(
            [str(STATE / "node"), str(project / "scripts/mint/locked-backup.mjs"),
             hold["version"], "--uninstall", str(lock.fileno())],
            cwd=project, check=True, timeout=2250, pass_fds=(lock.fileno(),),
            capture_output=True, text=True,
        )
        if outcome.stdout.splitlines().count("ARS_RECOVERY_REVIEW=" + uid) != 1:
            raise ValueError("Verified recovery review missing.")
        check()
    return {"schema": 1, "kind": "mint-uninstall-coordinator-rehearsal",
            "uninstallId": uid, "finalReviewMatched": True,
            "maintenanceHoldObserved": True, **{k: False for k in FLAGS}}

def review_under_maintenance(folder, lock):
    uid = folder.name
    spec = importlib.util.spec_from_file_location("uninstall_restore", Path(__file__).with_name("test-uninstall-restore-isolated.py"))
    restore = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(restore)
    observation = restore._inspect(folder, lock)
    if observation.get("uninstallId") != uid or observation.get("isolatedRestorePassed") is not True:
        raise ValueError("Restore observation mismatch.")
    plan = inspect_final(folder, lock)
    if plan.get("uninstallId") != uid or plan.get("restoreObservationMatched") is not True or any(plan.get(k) is not False for k in FLAGS):
        raise ValueError("Unexpected review result.")


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        raise SystemExit("Managed recovery folder required.")
    folder = Path(sys.argv[1])
    with os.fdopen(3, "a") as lock:
        review_under_maintenance(folder, lock)
    print("ARS_RECOVERY_REVIEW=" + folder.name)
