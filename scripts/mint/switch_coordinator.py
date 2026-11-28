"""Testable coordinator; deliberately no production service adapter or CLI."""
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
    record={"previous":str(old),"candidate":str(new),"phase":"prepared"}
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
