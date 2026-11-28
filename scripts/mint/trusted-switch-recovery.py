"""Resume a recorded offline switch using tools from the previous signed release."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tarfile
import tempfile

from signed_release_source import publisher_snapshot

STATE = Path.home() / ".local/share/ars-hardware"
RECOVERABLE = {"backup-verified", "offline-rollback-pending", "offline-rolled-back"}
CONFIRMATIONS = {
    "rollback": "ROLL BACK OFFLINE RELEASE",
    "finalize": "FINALIZE OFFLINE ROLLBACK",
}
OPTIONS = {"rollback": "--rollback-offline", "finalize": "--finalize-rollback"}
INITIAL_FILES = (
    "select-offline-release.py", "prepare-switch-intent.py", "prepare-runtime-activation.py",
    "switch_journal.py", "startup_guard.py", "interrupted_switch.py", "maintenance_backup.py",
    "resume_maintenance.py", "switch_coordinator.py", "release_fingerprint.py", "compose.yaml",
)


def install_initial_tools(state, project):
    """Preserve recovery code from the setup package outside the release pointer."""
    if (state / "project").resolve(strict=True) != project or project.is_relative_to(state):
        raise ValueError("Invalid initial installation.")
    scripts = project / "scripts/mint"
    if scripts.resolve(strict=True) != scripts:
        raise ValueError("Invalid installer recovery source.")
    manifest = json.loads(read_record(project / "PILOT-FILES.json", maximum=16777216))
    files = {}
    for name in INITIAL_FILES:
        raw = read_record(scripts / name, maximum=1048576)
        if manifest["scripts/mint/" + name]["sha256"] != hashlib.sha256(raw).hexdigest():
            raise ValueError("Initial recovery file differs from setup media.")
        files[name] = raw
    parent = state / "update-tools"
    if parent.resolve(strict=True) != parent or parent.stat().st_uid != os.getuid():
        raise ValueError("Invalid installed tools directory.")
    target = parent / "initial-release"
    if os.path.lexists(target):
        if initial_tools(state, project) != files:
            raise ValueError("Existing recovery tools differ from setup media.")
        return
    with tempfile.TemporaryDirectory(prefix=".initial-release-", dir=parent) as temporary:
        source = Path(temporary) / "tools"
        source.mkdir(mode=0o700)
        for name, raw in files.items():
            with (source / name).open("xb") as output:
                output.write(raw)
                output.flush()
                os.fsync(output.fileno())
        digests = {name: hashlib.sha256(raw).hexdigest() for name, raw in files.items()}
        with (source / "identity.json").open("x") as output:
            json.dump({"project": str(project), "files": digests}, output)
            output.flush()
            os.fsync(output.fileno())
        sync_directory(source)
        source.rename(target)
        sync_directory(parent)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def initial_tools(state, previous):
    directory = state / "update-tools/initial-release"
    if directory.resolve(strict=True) != directory or directory.stat().st_uid != os.getuid():
        raise ValueError("Invalid initial release tools.")
    receipt = json.loads(read_record(directory / "identity.json"))
    if receipt["project"] != str(previous) or set(receipt["files"]) != set(INITIAL_FILES):
        raise ValueError("Initial release identity mismatch.")
    # Execute a private copy of exactly the checked files, including imported modules.
    files = {}
    for name in INITIAL_FILES:
        raw = read_record(directory / name, maximum=1048576)
        if hashlib.sha256(raw).hexdigest() != receipt["files"][name]:
            raise ValueError("Installed recovery tools changed.")
        files[name] = raw
    return files


def requires_publisher(state, project):
    return project.is_relative_to(state / "staged-releases") or any(
        os.path.lexists(project / name) for name in
        (".ars-release-manifest.json", ".ars-release-manifest.sig", ".ars-release.tar.gz"))


def read_record(path, *, maximum=65536):
    if path.resolve(strict=True) != path:
        raise ValueError("Linked switch evidence.")
    def identity(info):
        return (info.st_dev, info.st_ino, info.st_mode, info.st_uid,
                info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    before = path.lstat()
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or not 0 < info.st_size <= maximum:
            raise ValueError("Invalid switch evidence.")
        raw = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
    if (len(raw) != info.st_size or identity(before) != identity(info)
            or identity(info) != identity(after) or identity(after) != identity(path.lstat())
            or path.resolve(strict=True) != path):
        raise ValueError("Switch evidence changed.")
    return raw


def evidence(state, action):
    journal = state / "switch-journal.json"
    raw = read_record(journal)
    record = json.loads(raw)
    phase = record.get("phase")
    allowed = RECOVERABLE if action == "resume" else {
        "rollback": {"backup-verified", "switched", "offline-rollback-pending"},
        "finalize": {"offline-rolled-back"},
    }[action]
    switch_id = record.get("switchId")
    if (record.get("schema") != 1 or record.get("kind") != "mint-offline-release-selection"
            or record.get("startupAllowed") is not False or phase not in allowed
            or not isinstance(switch_id, str) or not re.fullmatch(r"[a-f0-9]{32}", switch_id)):
        raise ValueError("Unsupported switch journal.")
    previous = Path(record["previous"])
    if previous.resolve(strict=True) != previous or not previous.is_dir() or previous == state:
        raise ValueError("Invalid previous release.")
    intent = state / "runtime-switch-intent.json"
    if phase == "offline-rolled-back" and not os.path.lexists(intent):
        intent = state / ("rolled-back-intent-" + switch_id + ".json")
    records = {journal.name: raw}
    for path, key in ((intent, "intentDigest"), (state / "maintenance-hold.json", "maintenanceDigest")):
        content = read_record(path)
        if hashlib.sha256(content).hexdigest() != record.get(key):
            raise ValueError("Switch evidence does not match.")
        records[path.name] = content
    pointer = state / "project"
    if not pointer.is_symlink():
        raise ValueError("Managed release pointer required.")
    active = pointer.resolve(strict=True)
    if str(active) not in (str(previous), record.get("candidate")):
        raise ValueError("Unexpected active release.")
    review = {name: hashlib.sha256(value).hexdigest() for name, value in records.items()}
    review["activeProject"] = str(active)
    return previous, phase, review


def recover(state, action, confirmation=None, expected_review=None, *, startup_condition=False):
    if state.resolve(strict=True) != state or state.stat().st_uid != os.getuid():
        raise ValueError("Managed switch state required.")
    previous, phase, review = evidence(state, action)
    if expected_review is not None and review != expected_review:
        raise ValueError("Operator-reviewed evidence changed.")
    command = ("finalize" if phase == "offline-rolled-back" else "rollback") if action == "resume" else action
    if startup_condition and (action != "resume" or command != "rollback"):
        raise ValueError("Startup only recovers interrupted selection.")
    if action != "resume" and confirmation != CONFIRMATIONS[command]:
        raise ValueError("Explicit switch recovery confirmation required.")
    def dispatch(source, worker, *binding):
        # Snapshot preparation can take time. Reject stale journal, hold, intent
        # or pointer before launching even the authenticated worker.
        if evidence(state, action) != (previous, phase, review):
            raise ValueError("Switch evidence changed before dispatch.")
        if not worker.is_file():
            raise ValueError("Verified switch recovery tools are unavailable.")
        # The worker checks the reviewed digests after acquiring the maintenance and update locks.
        invocation = ["/usr/bin/python3", "-E", "-s", "-B", str(worker), OPTIONS[command],
                      "--confirmation", CONFIRMATIONS[command],
                      "--reviewed-evidence", json.dumps(review), *binding]
        if startup_condition:
            invocation.extend(("--startup-control-pid", str(os.getpid())))
        subprocess.run(invocation, cwd=source, check=True)

    if requires_publisher(state, previous):
        with publisher_snapshot(previous, state / "release-signing-public.pem") as (source, verified, _):
            dispatch(source, source / "scripts/mint/select-offline-release.py",
                     "--publisher-archive-sha256", verified["archiveDigest"])
    else:
        files = initial_tools(state, previous)
        with tempfile.TemporaryDirectory(prefix="ars-initial-recovery-") as temporary:
            source = Path(temporary)
            for name, raw in files.items():
                (source / name).write_bytes(raw)
            dispatch(source, source / "select-offline-release.py", "--installed-recovery")
    return command



def show_update_center(source):
    entry = source / "scripts/mint/update-center.py"
    if entry.resolve(strict=True) != entry or not entry.is_file():
        raise ValueError("Update Center is unavailable.")
    subprocess.run(["/usr/bin/python3", "-E", "-s", "-B", str(entry)], cwd=source, check=True)


def interrupted_selection(record):
    return record.get("kind") == "mint-offline-release-selection" and record.get("phase") in (
        "backup-verified", "offline-rollback-pending")


def recover_before_startup(state):
    journal = state / "switch-journal.json"
    if os.path.lexists(journal) and interrupted_selection(json.loads(read_record(journal))):
        recover(state, "resume", startup_condition=True)


def open_update_center(state):
    # Resolve interrupted work from the installed bootstrap, independently of
    # the candidate currently selected by the release pointer.
    journal = state / "switch-journal.json"
    if not os.path.lexists(journal):
        show_update_center((state / "project").resolve(strict=True))
        return
    record = json.loads(read_record(journal))
    if record.get("kind") != "mint-offline-release-selection":
        raise ValueError("Unsupported switch journal.")
    phase = record.get("phase")
    if interrupted_selection(record):
        recover(state, "resume")
        subprocess.run(["zenity", "--info", "--no-markup", "--title=RS Nextward Update Center",
                        "--text=The previous release was selected. Reopen the Update Center to finalize the rollback. Maintenance remains active."],
                       check=False)
        return
    previous, _, _ = evidence(state, "finalize" if phase == "offline-rolled-back" else "rollback")
    if requires_publisher(state, previous):
        with publisher_snapshot(previous, state / "release-signing-public.pem") as (source, _, _):
            show_update_center(source)
    else:
        # Older unsigned installations keep the existing manual offline path.
        show_update_center(previous)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("resume", "rollback", "finalize", "update-center", "pre-start", "install-initial"))
    parser.add_argument("--initial-project", type=Path)
    parser.add_argument("--confirmation")
    parser.add_argument("--reviewed-evidence")
    args = parser.parse_args()
    if os.geteuid() == 0:
        parser.exit(1, "Run as the installed desktop user.\n")
    try:
        if args.action == "install-initial":
            if args.initial_project is None:
                raise ValueError("Initial project required.")
            install_initial_tools(STATE, args.initial_project)
        elif args.action == "pre-start":
            recover_before_startup(STATE)
        elif args.action == "update-center":
            open_update_center(STATE)
        else:
            recover(STATE, args.action, args.confirmation,
                    json.loads(args.reviewed_evidence) if args.reviewed_evidence else None)
    except (OSError, ValueError, RuntimeError, TypeError, KeyError, AttributeError, tarfile.TarError,
            subprocess.SubprocessError):
        message = "Switch recovery could not be verified. Contact RS Nextward."
        if args.action == "update-center":
            subprocess.run(["zenity", "--error", "--no-markup", "--title=RS Nextward Update Center",
                            "--text=" + message], check=False)
        parser.exit(1, message + "\n")


if __name__ == "__main__":
    main()
