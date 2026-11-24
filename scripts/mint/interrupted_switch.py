"""Classify interrupted software switches; never start services or modify data."""
import json
from pathlib import Path

def recovery_plan(root):
    root=Path(root).resolve(strict=True)
    journal=root/"switch-journal.json"
    pointer=root/"project"
    if not journal.is_file() or journal.is_symlink() or not pointer.is_symlink():
        return {"action":"manual-review","reason":"Missing or invalid journal or pointer"}
    try:
        record=json.loads(journal.read_text())
        previous=Path(record["previous"]).resolve(strict=True)
        candidate=Path(record["candidate"]).resolve(strict=True)
        active=pointer.resolve(strict=True)
        phase=record["phase"]
        if previous==candidate or active not in (previous,candidate):
            raise ValueError("Unexpected release")
        if any(not (p/"dist/server.cjs").is_file() for p in (previous,candidate)):
            raise ValueError("Missing executable")
    except (OSError,ValueError,TypeError,KeyError,RuntimeError):
        return {"action":"manual-review","reason":"Invalid recovery state"}
    if phase=="completed" and active==candidate:
        return {"action":"verify-current","reason":"Completed switch"}
    if phase=="rolled-back" and active==previous:
        return {"action":"verify-previous","reason":"Completed rollback"}
    if phase in ("prepared","stopped","backup-verified","switched","rollback-required","previous-selected","shutdown-unconfirmed","manual-recovery-required"):
        return {"action":"hold-for-review","reason":"Interrupted update; verify shutdown, backup and database compatibility before switching","active":str(active),"previous":str(previous),"candidate":str(candidate),"phase":phase}
    return {"action":"manual-review","reason":"Unexpected journal phase and pointer combination"}
