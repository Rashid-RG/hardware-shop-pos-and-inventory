"""Optional one-shot desktop login continuation, without retained authorization."""
import os
from pathlib import Path
import stat

def entry(root):
    script=root.resolve()/"scripts/mint/setup-wizard.py"
    # Desktop Entry string escaping precedes Exec argument escaping.
    arg=str(script)
    if any(ord(c)<32 for c in arg):
        raise RuntimeError("Unsupported setup folder name.")
    arg=''.join('\\'+c if c in '"'+chr(96)+'$\\' else c for c in arg)
    arg=arg.replace('\\','\\\\').replace('%','%%')
    return ("[Desktop Entry]\nType=Application\nName=RS Nextward Setup Continuation\n"
            'Exec=/usr/bin/python3 "'+arg+'"\nTerminal=false\n')

def location():
    folder=Path.home()/".config/autostart"
    return folder/"rs-nextward-ars-pilot-resume.desktop"

def consume_resume(root):
    target=location()
    if not os.path.lexists(target):
        return
    if target.parent.resolve()!=target.parent:
        raise RuntimeError("Unexpected linked autostart directory.")
    info=target.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid():
        raise RuntimeError("Unexpected setup continuation entry.")
    if target.read_text()!=entry(root):
        raise RuntimeError("Another setup continuation exists. Contact support.")
    target.unlink()

def offer_resume(root, dialog):
    if dialog("--question","--no-markup","--text=Would you like RS Nextward Setup to reopen once at your next sign-in? You will still review the agreement and confirm installation. No administrator permission will be retained.","--ok-label=Reopen at next sign-in","--cancel-label=I'll reopen manually"):
        return
    target=location()
    target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    if target.parent.resolve()!=target.parent:
        raise RuntimeError("Unexpected linked autostart directory.")
    with os.fdopen(os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600),"w") as stream:
        stream.write(entry(root))
