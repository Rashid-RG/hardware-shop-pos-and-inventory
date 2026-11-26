#!/usr/bin/env python3
"""Install non-overwriting recovery shortcuts; no startup or database operations."""
from pathlib import Path
import os
import subprocess
import sys

STATE=Path.home()/".local/share/ars-hardware"
def desktop_entry(script):
    if any(c in str(script) for c in "\n\r"):
        raise ValueError("Invalid launcher path.")
    arg=''.join('\\'+c if c in '"\x60$\\' else c for c in str(script)).replace('\\','\\\\').replace('%','%%')
    return f'[Desktop Entry]\nType=Application\nName=ARS Distributor Recovery Center\nComment=RS Nextward read-only recovery diagnostics\nExec=python3 "{arg}"\nIcon=system-help\nTerminal=false\nCategories=System;\n'

def install_shortcut(folder,entry):
    if folder.resolve(strict=True)!=folder or not folder.is_dir():
        raise ValueError("Invalid shortcut directory.")
    target=folder/"ars-recovery-center.desktop"
    try:
        with os.fdopen(os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o755),"w") as stream:
            stream.write(entry)
            stream.flush()
            os.fsync(stream.fileno())
    except FileExistsError:
        if target.is_symlink() or not target.is_file() or target.stat().st_size>8192 or target.read_text()!=entry:
            raise ValueError("Existing shortcut retained; review required.")
    return target

def main():
    if os.geteuid()==0:raise ValueError("Run as desktop user.")
    project=(STATE/"project").resolve(strict=True)
    script=STATE/"project"/"scripts/mint/recovery-center.py"
    if not script.is_file() or script.resolve()!=project/"scripts/mint/recovery-center.py":
        raise ValueError("Recovery script unavailable.")
    desktop=Path(subprocess.run(["xdg-user-dir","DESKTOP"],check=True,capture_output=True,text=True,timeout=10).stdout.strip())
    if not desktop.is_absolute():raise ValueError("Invalid desktop directory.")
    menu=Path.home()/".local/share/applications"
    entry=desktop_entry(script)
    install_shortcut(menu,entry)
    target=install_shortcut(desktop,entry)
    subprocess.run(["gio","set",str(target),"metadata::trusted","true"],check=False,capture_output=True,timeout=10)
    print("Recovery shortcuts available. No startup or database settings changed.")

if __name__=="__main__":
    try:main()
    except (OSError,ValueError,subprocess.SubprocessError):
        sys.exit("Recovery shortcut installation blocked; existing shortcuts retained.")
