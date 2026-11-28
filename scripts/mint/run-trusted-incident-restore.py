#!/usr/bin/env python3
"""Run the isolated incident restore from an independently verified release."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import tarfile

from signed_release_source import publisher_snapshot

STATE = Path.home() / ".local/share/ars-hardware"
CONFIRMATION = "RUN ISOLATED INCIDENT RESTORE"


def run(project, runtime, trust, node, confirmation):
    if confirmation != CONFIRMATION:
        raise ValueError("Explicit isolated restore confirmation required.")
    if not runtime.is_absolute() or runtime.resolve(strict=True) != runtime or not runtime.is_dir():
        raise ValueError("A plain absolute runtime directory is required.")
    with publisher_snapshot(project, trust) as (source, _, _assets):
        entry = source / "scripts/writer-loss-restore-runner.mjs"
        if not entry.is_file():
            raise ValueError("This release lacks the isolated incident restore entry point.")
        environment = os.environ.copy()
        for key in ("NODE_OPTIONS", "NODE_PATH", "PYTHONPATH", "PYTHONHOME", "PYTHONPYCACHEPREFIX"):
            environment.pop(key, None)
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        subprocess.run([str(node), str(entry), str(runtime), confirmation], cwd=source,
                       env=environment, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path, help="Absolute path to the retained signed release")
    parser.add_argument("--confirmation", required=True)
    args = parser.parse_args()
    if os.geteuid() == 0:
        parser.exit(1, "Run as the installed desktop user.\n")
    try:
        run(args.project, STATE / "runtime", STATE / "release-signing-public.pem",
            (STATE / "node").resolve(strict=True), args.confirmation)
    except (OSError, RuntimeError, TypeError, AttributeError, ValueError, subprocess.SubprocessError, tarfile.TarError):
        parser.exit(1, "Trusted isolated restore did not complete. Review the retained incident evidence.\n")


if __name__ == "__main__":
    main()
