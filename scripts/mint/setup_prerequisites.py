"""Consent-based Mint prerequisite bootstrap using configured signed apt repositories."""
import shutil
import subprocess

def run_ok(args):
    try:
        return subprocess.run(args,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode == 0
    except OSError:
        return False

def candidate(package):
    result=subprocess.run(["apt-cache","policy",package],check=True,capture_output=True,text=True,env={"PATH":"/usr/bin:/bin","LC_ALL":"C"})
    return next((line.split(":",1)[1].strip() for line in result.stdout.splitlines() if line.strip().startswith("Candidate:")), "(none)")

def install_missing(dialog):
    if not shutil.which("apt-cache"):
        raise RuntimeError("APT package manager is required.")
    packages=[]
    node=shutil.which("node")
    npm=shutil.which("npm")
    if node:
        if not npm or not run_ok(["node","-e","const [a,b]=process.versions.node.split('.').map(Number);if(a!==22||b<12)process.exit(1)"]):
            raise RuntimeError("Existing Node.js is incompatible or incomplete. Setup will not replace it automatically.")
    elif npm:
        raise RuntimeError("Existing npm without Node.js requires support review.")
    else:
        version=candidate("nodejs")
        import re
        match=re.match(r"^(?:\d+:)?22\.(\d+)\.",version)
        if not match or int(match.group(1))<12 or candidate("npm")=="(none)":
            raise RuntimeError("Configured APT repositories do not provide a compatible Node.js 22.12+ and npm. A trusted runtime source must be prepared by support.")
        packages.extend(["nodejs","npm"])
    if shutil.which("docker"):
        if not run_ok(["docker","info"]):
            raise RuntimeError("Existing Docker is not accessible. Start Docker or ask support to review account permissions.")
        if not run_ok(["docker","compose","version"]):
            raise RuntimeError("Existing Docker has no Compose v2. Setup will not mix Docker package providers.")
    else:
        if candidate("docker.io")=="(none)" or candidate("docker-compose-v2")=="(none)":
            raise RuntimeError("Configured APT repositories do not provide Docker Engine and Compose v2.")
        packages.extend(["docker.io","docker-compose-v2"])
    if not packages:
        return True
    if not shutil.which("pkexec"):
        raise RuntimeError("Graphical administrator authorization (pkexec) is unavailable.")
    if dialog("--question","--no-markup","--text=Setup needs these packages from configured system repositories:\n"+", ".join(packages)+"\nAdministrator authorization is required. Continue?","--ok-label=Install requirements","--cancel-label=Cancel"):
        return False
    # APT confirms repository signatures. Never add repositories, remove packages,
    # bypass authentication, change Docker group membership or run application as root.
    subprocess.run(["pkexec","/usr/bin/apt-get","--no-remove","--assume-yes","install",*packages],check=True)
    dialog("--info","--no-markup","--text=Prerequisites installed. Reopen Setup after administrator review of Docker access. No ARS database was created.")
    return False
