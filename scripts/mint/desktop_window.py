"""Dedicated Chromium application-mode window, using a separate ARS profile."""
import os
from pathlib import Path
import shutil
import subprocess

URL="http://localhost:3000"

def browser_path():
    for name in ("google-chrome-stable","google-chrome","chromium","chromium-browser","microsoft-edge-stable"):
        candidate=shutil.which(name)
        if candidate:
            return candidate
    raise RuntimeError("A supported Chromium-based browser is required for the ARS desktop window. Contact RS Nextward setup support.")

def command(browser,profile):
    return [browser,"--app="+URL,"--user-data-dir="+str(profile),
            "--no-first-run","--no-default-browser-check"]

def open_window():
    browser=browser_path()
    profile=Path.home()/".local/share/ars-hardware/desktop-profile"
    if profile.resolve()!=profile:
        raise RuntimeError("Unexpected linked desktop profile.")
    profile.mkdir(mode=0o700,exist_ok=True)
    if profile.stat().st_uid!=os.getuid() or profile.stat().st_mode & 0o077:
        raise RuntimeError("Desktop profile permissions are unsafe.")
    process=subprocess.Popen(command(browser,profile),stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL,start_new_session=True)
    try:
        result=process.wait(timeout=1)
    except subprocess.TimeoutExpired:
        return
    if result!=0:
        raise RuntimeError("ARS desktop window could not open.")
