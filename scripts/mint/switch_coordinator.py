"""Release switch rehearsals and guarded installed service operations."""
from pathlib import Path
from switch_journal import switch_pointer, write_journal

def simulate_switch(root, service, backup):
    """Exercise switching in a disposable directory using injected test doubles."""
    root=Path(root).resolve(strict=True)
    if not (root/".ars-switch-test").is_file():
        raise ValueError("Disposable switch test directory required.")
    pointer=root/"project"
    old=root/"old"
    new=root/"new"
    if not pointer.is_symlink() or pointer.resolve()!=old or any(p.is_symlink() or not p.is_dir() for p in (old,new)):
        raise ValueError("Invalid sandbox release layout.")
    record={"kind":"mint-switch-rehearsal","previous":str(old),"candidate":str(new),"phase":"prepared"}
    def phase(value):
        record["phase"]=value
        write_journal(root,record)
    phase("prepared")
    try:
        service.stop()
        if not service.stopped():
            raise RuntimeError("Cannot confirm shutdown.")
    except Exception:
        phase("shutdown-unconfirmed")
        raise
    try:
        phase("stopped")
        if backup() is not True:
            raise RuntimeError("Verified backup required.")
        phase("backup-verified")
        switch_pointer(pointer,old,new)
        phase("switched")
        service.start()
        if not service.ready():
            raise RuntimeError("Candidate readiness failed.")
        phase("completed")
        return "updated"
    except Exception:
        phase("rollback-required")
        try:
            service.stop()
            if not service.stopped():
                raise RuntimeError("Cannot safely reverse while service may be running.")
            if pointer.resolve()==new:
                switch_pointer(pointer,new,old)
            elif pointer.resolve()!=old:
                raise RuntimeError("Unexpected release pointer.")
            phase("previous-selected")
            service.start()
            if not service.ready():
                raise RuntimeError("Previous version failed readiness.")
        except Exception:
            phase("manual-recovery-required")
            raise
        phase("rolled-back")
        return "rolled-back"


def resume_interrupted_switch(root,service,verify_backup,verify_release):
    """Conservatively recover a disposable interrupted coordinator transaction.

    Never resume an interrupted candidate forward. Verify retained backup,
    release and stopped writer evidence before selecting the previous release.
    Production adapters are intentionally not authorized by this test entry.
    """
    import json
    root=Path(root).resolve(strict=True)
    if not (root/".ars-switch-test").is_file():
        raise ValueError("Disposable switch test directory required.")
    pointer=root/"project"
    old,new=root/"old",root/"new"
    journal=root/"switch-journal.json"
    if journal.is_symlink() or not journal.is_file() or journal.stat().st_size>16384:
        raise ValueError("Invalid recovery journal.")
    original=journal.read_bytes()
    record=json.loads(original)
    if record.get("kind")!="mint-switch-rehearsal" or record.get("previous")!=str(old) or record.get("candidate")!=str(new) or record.get("phase") not in ("backup-verified","switched","rollback-required","previous-selected"):
        raise ValueError("Unsupported recovery state.")
    if not pointer.is_symlink() or pointer.resolve(strict=True) not in (old,new) or any(p.is_symlink() or not p.is_dir() for p in (old,new)):
        raise ValueError("Invalid recovery layout.")
    def phase(value):
        record["phase"]=value
        write_journal(root,record)
    if verify_backup() is not True or verify_release(old) is not True or journal.read_bytes()!=original:
        raise ValueError("Recovery evidence mismatch.")
    try:
        service.stop()
        if not service.stopped():
            raise RuntimeError("Cannot confirm stopped writer.")
        if verify_backup() is not True or verify_release(old) is not True or journal.read_bytes()!=original:
            raise RuntimeError("Recovery evidence changed.")
        phase("rollback-required")
        if pointer.resolve(strict=True)==new:
            switch_pointer(pointer,new,old)
        elif pointer.resolve(strict=True)!=old:
            raise RuntimeError("Unexpected active release.")
        phase("previous-selected")
        if verify_release(old) is not True:
            raise RuntimeError("Previous release changed.")
        service.start()
        if not service.ready():
            raise RuntimeError("Previous release failed readiness.")
        phase("rolled-back")
        return "rolled-back"
    except Exception:
        try:
            service.stop()
        finally:
            phase("manual-recovery-required")
        raise

class InstalledMintService:
    """Managed service operations, not release activation authorization.

    The caller must hold the maintenance and update locks and verify signed
    releases, backup and startup authorization independently. No bypass of
    systemd or application startup guards is provided.
    """
    def __init__(self, state, *, stopped_check=None, readiness_check=None):
        self.state = Path(state)
        if not self.state.is_absolute() or self.state.resolve(strict=True) != self.state:
            raise ValueError("Plain absolute managed state required.")
        self.expected = None
        self.stopped_check = stopped_check
        self.readiness_check = readiness_check

    def bind(self, project, version):
        import re
        project = Path(project)
        if not project.is_absolute() or project.resolve(strict=True) != project or not project.is_dir():
            raise ValueError("Invalid managed release.")
        if not isinstance(version, str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?", version):
            raise ValueError("Invalid managed version.")
        self.expected = (project, version)

    def _assert_selected(self):
        if self.expected is None:
            raise ValueError("Expected release must be bound first.")
        pointer = self.state / "project"
        if not pointer.is_symlink() or pointer.resolve(strict=True) != self.expected[0]:
            raise RuntimeError("Managed release pointer changed.")

    def stop(self):
        import subprocess
        self.expected = None
        subprocess.run(["systemctl", "--user", "stop", "ars-hardware.service"], check=True, timeout=180)

    def stopped(self):
        from maintenance_backup import stopped
        (self.stopped_check or stopped)()
        return True

    def start(self):
        import subprocess
        from startup_guard import startup_allowed
        self._assert_selected()
        self.stopped()
        if not startup_allowed(self.state):
            raise RuntimeError("Installed startup guard blocked service start.")
        self._assert_selected()
        subprocess.run(["systemctl", "--user", "start", "--no-block", "ars-hardware.service"], check=True, timeout=30)

    def ready(self):
        from resume_maintenance import wait_for_current_release
        self._assert_selected()
        if self.readiness_check is None:
            wait_for_current_release(*self.expected, state=self.state)
        else:
            self.readiness_check(*self.expected)
        self._assert_selected()
        return True

