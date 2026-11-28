"""Install only missing distribution packages with explicit administrator approval."""
import os
import shutil
import subprocess

def run(args):
    try:
        return subprocess.run(args, check=False, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, timeout=20).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False

def plan():
    packages = []
    for executable, package in (("node", "nodejs"), ("npm", "npm"),
                                ("docker", "docker.io"), ("gio", "libglib2.0-bin"),
                                ("xdg-open", "xdg-utils"), ("xdg-user-dir", "xdg-user-dirs")):
        if not shutil.which(executable):
            packages.append(package)
    if not run(["docker", "compose", "version"]):
        # Package names vary by Mint release. Never add an untrusted repository.
        for candidate in ("docker-compose-v2", "docker-compose-plugin"):
            if run(["apt-cache", "show", candidate]):
                packages.append(candidate)
                break
    return sorted(set(packages))

def install_missing(dialog):
    if os.geteuid() == 0 or not shutil.which("pkexec") or not shutil.which("apt-get"):
        return False
    packages = plan()
    if not packages:
        return True
    if not dialog("--question", "Install these missing Linux distribution packages with administrator approval?\n\n" +
                  ", ".join(packages) + "\n\nNo external repositories will be added."):
        return False
    try:
        # Polkit authenticates the administrator; never collect their password.
        result = subprocess.run(["pkexec", "/usr/bin/apt-get", "install", "-y", "--", *packages], check=False)
        return result.returncode == 0
    except OSError:
        return False
