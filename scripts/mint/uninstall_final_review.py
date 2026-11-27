"""Pure, non-authorizing final uninstall observation review."""
import re

FLAGS = ("applicationRemovalAllowed", "databaseDeletionAllowed", "serviceRemovalAllowed",
         "uninstalled", "finalUninstallBackupVerified", "continuousExclusionVerified")


def review(observation, uninstall_id, archive, evidence, members):
    """Compare a restore observation with independently collected current digests.

    This is not a live shutdown check or continuous exclusion certification.
    """
    if not isinstance(uninstall_id, str) or not re.fullmatch(r"[a-f0-9]{32}", uninstall_id):
        raise ValueError("Invalid uninstall identity.")
    if observation.get("schema") != 1 or observation.get("kind") != "mint-uninstall-restore-observation" or observation.get("uninstallId") != uninstall_id:
        raise ValueError("Restore observation identity mismatch.")
    if any(observation.get(flag) is not False for flag in FLAGS):
        raise ValueError("Unexpected authorization.")
    if any(observation.get(flag) is not True for flag in ("isolatedRestorePassed", "allPublicTableFingerprintsMatched", "uploadArchiveIntegrityVerified")):
        raise ValueError("Incomplete restore observation.")
    for key, minimum in (("restoredTableCount", 5), ("uploadMemberCount", 0)):
        if type(observation.get(key)) is not int or observation[key] < minimum:
            raise ValueError("Invalid restore count.")
    if not isinstance(evidence, dict) or set(evidence) != {"shutdown", "hold", "meta", "receipt"}:
        raise ValueError("Incomplete shutdown evidence.")
    if not isinstance(archive, str) or not re.fullmatch(r"ars-mint-[A-Za-z0-9_-]+-with-uploads\.dump", archive):
        raise ValueError("Invalid archive.")
    if not isinstance(members, dict) or archive not in members or len(members) < 5:
        raise ValueError("Incomplete archive evidence.")
    for actual, recorded in ((evidence, observation.get("evidenceDigests")), (members, observation.get("archiveMemberDigests"))):
        if any(not isinstance(v, str) or not re.fullmatch(r"[a-f0-9]{64}", v) for v in actual.values()) or actual != recorded:
            raise ValueError("Recovery evidence mismatch.")
    if observation.get("archiveSha256") != members[archive]:
        raise ValueError("Archive digest mismatch.")
    return {"schema": 1, "kind": "mint-final-uninstall-evidence-review",
            "uninstallId": uninstall_id, "restoreObservationMatched": True,
            "evidenceDigests": dict(evidence), "archiveMemberDigests": dict(members),
            **{flag: False for flag in FLAGS}}


def inspect(folder):
    """Read and compare current managed recovery evidence under maintenance locks."""
    import fcntl
    import hashlib
    import importlib.util
    import json
    import os
    from pathlib import Path
    from repair_interruption import read_regular
    from resume_maintenance import open_lock
    from maintenance_backup import stopped
    from uninstall_cancellation import validate, CONFIRMATION

    state = Path.home() / ".local/share/ars-hardware"
    if os.geteuid() == 0 or state.resolve(strict=True) != state or state.stat().st_uid != os.getuid():
        raise ValueError("Managed desktop user required.")
    if folder.parent != state / "uninstall-recovery" or folder.resolve(strict=True) != folder or folder.stat().st_uid != os.getuid() or not re.fullmatch(r"[a-f0-9]{32}", folder.name):
        raise ValueError("Managed uninstall recovery required.")
    spec = importlib.util.spec_from_file_location("uninstall_restore", Path(__file__).with_name("test-uninstall-restore-isolated.py"))
    restore = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(restore)
    prepare = restore.load_prepare()
    paths = {"hold": state / "maintenance-hold.json", "shutdown": state / "uninstall-shutdown.json",
             "meta": folder / "recovery.json", "receipt": folder / "maintenance-backup-receipt.json",
             "restore": folder / "uninstall-restore-test.json"}
    def snapshot():
        for marker in ("repair-interrupted.json", "runtime-switch-intent.json", "runtime-activation-interrupted.json", "runtime-migration-interrupted.json", "switch-journal.json", "handoff-pending.json"):
            if os.path.lexists(state / marker):
                raise ValueError("Unresolved maintenance incident.")
        stopped()
        project = (state / "project").resolve(strict=True)
        if project != Path(__file__).resolve().parents[2]:
            raise ValueError("Managed installation required.")
        raw = {key: read_regular(path) for key, path in paths.items()}
        hold, meta, receipt = (json.loads(raw[key]) for key in ("hold", "meta", "receipt"))
        validate(raw["hold"], raw["shutdown"], project, CONFIRMATION)
        prepare.validate_hold(hold, project, meta["version"])
        digests = {key: hashlib.sha256(value).hexdigest() for key, value in raw.items() if key != "restore"}
        if hold["uninstallId"] != folder.name or meta.get("uninstallId") != folder.name or meta.get("kind") != "mint-final-uninstall-backup" or meta.get("previousProject") != str(project) or meta.get("shutdownDigest") != digests["shutdown"] or any(meta.get(key) is not False for key in ("activationApproved", "restoreTestPassed", "applicationRemovalAllowed", "databaseDeletionAllowed")):
            raise ValueError("Backup identity mismatch.")
        if receipt.get("kind") != "mint-uninstall-backup-observation" or receipt.get("uninstallId") != folder.name or receipt.get("holdDigest") != digests["hold"] or receipt.get("shutdownDigest") != digests["shutdown"] or receipt.get("recoveryDigest") != digests["meta"] or receipt.get("archive") != meta["archive"] or receipt.get("database") != "hardware_pos_ars" or receipt.get("locksObserved") is not True or any(receipt.get(key) is not False for key in ("activationAllowed", "applicationRemovalAllowed", "finalUninstallBackupVerified", "continuousExclusionVerified")):
            raise ValueError("Backup receipt mismatch.")
        if not prepare.ARCHIVE.fullmatch(meta["archive"]):
            raise ValueError("Invalid archive name.")
        members = {p.name: restore.sha(p) for p in prepare.members(folder / meta["archive"])}
        if members[meta["archive"]] != meta.get("archiveSha256"):
            raise ValueError("Archive digest mismatch.")
        plan = review(json.loads(raw["restore"]), folder.name, meta["archive"], digests, members)
        return plan, raw
    with open_lock(state / "maintenance.lock") as maintenance, open_lock(state / "update.lock") as update:
        for lock in (maintenance, update):
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        first = snapshot()
        if snapshot() != first:
            raise ValueError("Recovery evidence changed during review.")
        return first[0]
