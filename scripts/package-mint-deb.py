#!/usr/bin/env python3
"""Build acceptance-only DEB. System package installs setup media, not business data."""
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

source,out=map(Path,sys.argv[1:])
archives=list(source.glob("*.zip"))
if len(archives)!=1:
    raise SystemExit("Expected exactly one validated ZIP")
archive=archives[0]
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
if archive.with_suffix(".zip.sha256").read_text().split()[0]!=digest:
    raise SystemExit("Package checksum mismatch")
out.mkdir(exist_ok=True,parents=True)
with tempfile.TemporaryDirectory() as folder:
    root=Path(folder)
    def put(name,data,mode=0o644):
        target=root/name
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(data if isinstance(data,bytes) else data.encode())
        target.chmod(mode)
    put("DEBIAN/control", """Package: ars-distributor-pilot-setup
Version: 1.0.0
Section: utils
Priority: optional
Architecture: amd64
Maintainer: RS Nextward
Depends: python3 (>= 3.12), python3-gi, gir1.2-gtk-3.0, zenity, policykit-1, xdg-utils, xdg-user-dirs
Description: ARS Distributor acceptance setup media
 Installs setup launcher only. Run the graphical wizard as the desktop user.
 No business database is created by package installation or removal.
""")
    put("usr/share/ars-distributor-pilot/payload.zip",archive.read_bytes())
    put("usr/share/ars-distributor-pilot/payload.sha256",digest+"\n")
    put("usr/share/ars-distributor-pilot/launch.py",Path("scripts/mint/native-setup-launch.py").read_bytes(),0o755)
    put("usr/share/applications/ars-distributor-pilot-setup.desktop","""[Desktop Entry]
Type=Application
Name=RS Nextward | ARS Distributor Setup
Exec=/usr/bin/python3 /usr/share/ars-distributor-pilot/launch.py
Icon=system-software-install
Terminal=false
Categories=System;
""")
    target=out/"ARS-Distributor-Setup.deb"
    subprocess.run(["dpkg-deb","--root-owner-group","--build",str(root),str(target)],check=True)
    subprocess.run(["dpkg-deb","--info",str(target)],check=True)
    with tempfile.TemporaryDirectory() as extracted:
        subprocess.run(["dpkg-deb","--extract",str(target),extracted],check=True)
        payload=Path(extracted)/"usr/share/ars-distributor-pilot/payload.zip"
        assert hashlib.sha256(payload.read_bytes()).hexdigest()==digest
        subprocess.run([sys.executable,str(Path(extracted)/"usr/share/ars-distributor-pilot/launch.py"),"--verify-payload"],check=True)
    target.with_suffix(".deb.sha256").write_text(hashlib.sha256(target.read_bytes()).hexdigest()+"  "+target.name+"\n")
