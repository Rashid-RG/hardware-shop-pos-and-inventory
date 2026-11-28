"""Consent-based Mint prerequisite bootstrap using configured signed apt repositories."""
import shutil
import os
import grp
import pwd
import stat
import subprocess

def run_ok(args):
    try:
        return subprocess.run(args,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode == 0
    except OSError:
        return False

def candidate(package):
    result=subprocess.run(["apt-cache","policy",package],check=True,capture_output=True,text=True,env={"PATH":"/usr/bin:/bin","LC_ALL":"C"})
    return next((line.split(":",1)[1].strip() for line in result.stdout.splitlines() if line.strip().startswith("Candidate:")), "(none)")

def configure_docker_access(dialog, resume):
    # Only handle the standard local rootful Docker service. Never change
    # socket permissions, remote contexts, daemon configuration or sudo policy.
    if os.geteuid()==0 or os.environ.get("DOCKER_HOST") or os.environ.get("DOCKER_CONTEXT"):
        raise RuntimeError("Custom Docker access requires support review.")
    context=subprocess.run(["docker","context","show"],check=True,capture_output=True,text=True).stdout.strip()
    if context!="default":
        raise RuntimeError("Non-default Docker context requires support review.")
    if not run_ok(["systemctl","is-active","--quiet","docker.service"]):
        raise RuntimeError("Docker service is not active. Ask an administrator to start it.")
    user=pwd.getpwuid(os.getuid()).pw_name
    group=grp.getgrnam("docker")
    info=os.stat("/var/run/docker.sock")
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid!=0 or info.st_gid!=group.gr_gid:
        raise RuntimeError("Unexpected Docker socket ownership. No permissions were changed.")
    if group.gr_gid in os.getgroups():
        raise RuntimeError("Docker access failed despite active membership. Contact support.")
    if user in group.gr_mem or pwd.getpwuid(os.getuid()).pw_gid==group.gr_gid:
        resume()
        dialog("--info","--no-markup","--text=Docker access is already configured. Sign out of Linux Mint and sign back in, then reopen Setup.")
        return False
    if not shutil.which("pkexec") or not os.path.isfile("/usr/sbin/usermod"):
        raise RuntimeError("Administrator authorization tools are missing.")
    if dialog("--question","--no-markup","--width=560","--text=Docker access is required for the local PostgreSQL database. Adding this account to the Docker group grants root-equivalent access to this computer. Only approve for a trusted administrator-managed account. Setup will not change any database or socket permissions.","--ok-label=Authorize Docker access","--cancel-label=Cancel"):
        return False
    subprocess.run(["pkexec","/usr/sbin/usermod","-aG","docker","--",user],check=True)
    resume()
    dialog("--info","--no-markup","--text=Docker access configured. Save your work, sign out of Linux Mint and sign back in, then reopen Setup. No ARS database was created.")
    return False

def verify_docker_endpoint():
    if any(key in os.environ for key in ("DOCKER_HOST","DOCKER_CONTEXT","DOCKER_TLS_VERIFY","DOCKER_CERT_PATH")):
        raise RuntimeError("Setup requires the local Docker socket without connection overrides.")
    if shutil.which("docker"):
        endpoint=subprocess.run(
            ["docker","context","inspect","--format","{{.Endpoints.docker.Host}}"],
            check=True,capture_output=True,text=True,timeout=10,
        ).stdout.strip()
        if endpoint!="unix:///var/run/docker.sock":
            raise RuntimeError("Setup requires the standard local Docker socket.")


def install_missing(dialog, resume=lambda: None):
    verify_docker_endpoint()
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
    if not shutil.which("docker"):
        if candidate("docker.io")=="(none)" or candidate("docker-compose-v2")=="(none)":
            raise RuntimeError("Configured APT repositories do not provide Docker Engine and Compose v2.")
        packages.extend(["docker.io","docker-compose-v2"])
    if not packages:
        return verify_docker_ready(dialog, resume)
    if not shutil.which("pkexec"):
        raise RuntimeError("Graphical administrator authorization (pkexec) is unavailable.")
    if dialog("--question","--no-markup","--text=Setup needs these packages from configured system repositories:\n"+", ".join(packages)+"\nAdministrator authorization is required. Continue?","--ok-label=Install requirements","--cancel-label=Cancel"):
        return False
    # APT confirms repository signatures. Never add repositories, remove packages,
    # bypass authentication or run application as root.
    subprocess.run(["pkexec","/usr/bin/apt-get","--no-remove","--assume-yes","install",*packages],check=True)
    return verify_docker_ready(dialog, resume)


def verify_docker_ready(dialog, resume):
    verify_docker_endpoint()
    if not run_ok(["docker","compose","version"]):
        raise RuntimeError("Docker Compose v2 is required.")
    if not run_ok(["docker","info"]):
        if not run_ok(["/usr/bin/systemctl","is-active","--quiet","docker.service"]):
            if not shutil.which("pkexec"):
                raise RuntimeError("Graphical administrator authorization (pkexec) is unavailable.")
            if dialog("--question","--no-markup","--text=Start the local Docker service so Setup can prepare PostgreSQL? Administrator authorization is required.","--ok-label=Start Docker","--cancel-label=Cancel"):
                return False
            subprocess.run(["pkexec","/usr/bin/systemctl","start","docker.service"],check=True,timeout=90)
        if not run_ok(["docker","info"]):
            return configure_docker_access(dialog, resume)
    result=subprocess.run(["docker","info","--format","{{.OSType}}"],check=True,capture_output=True,text=True,timeout=15)
    if result.stdout.strip()!="linux":
        raise RuntimeError("Setup requires Linux containers.")
    return True
