"""Read-only startup guard. No database or service modifications."""
import sys
from pathlib import Path
from interrupted_switch import recovery_plan

def startup_allowed(root):
    root=Path(root)
    journal=root/"switch-journal.json"
    if not journal.exists() and not journal.is_symlink():
        return True
    return recovery_plan(root)["action"] in ("verify-current","verify-previous")

if __name__=="__main__":
    try:
        allowed=startup_allowed(Path.home()/".local/share/ars-hardware")
    except (OSError,ValueError,RuntimeError):
        allowed=False
    if not allowed:
        print("ARS Distributor: interrupted update requires RS Nextward recovery review. No database restore was attempted.",file=sys.stderr)
        sys.exit(1)
