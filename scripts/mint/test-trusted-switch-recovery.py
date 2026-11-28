"""Exercise installed rollback dispatch with a disposable publisher key and journal."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


recovery = load("trusted_switch", HERE / "trusted-switch-recovery.py")
center = load("update_center", HERE / "update-center.py")
signer = load("signer", HERE.parent / "sign-update-release.py")


class TrustedSwitchRecoveryTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.previous = self.root / "old"
        self.candidate = self.root / "new"
        self.candidate.mkdir()
        self.worker = self.previous / "scripts/mint/select-offline-release.py"
        self.worker.parent.mkdir(parents=True)
        (self.previous / "package.json").write_text('{"version":"1.2.3"}')
        self.worker.write_text(
            "import json, sys\nfrom pathlib import Path\n"
            f"Path({str(self.root / 'dispatch.json')!r}).write_text(json.dumps(sys.argv[1:]))\n"
        )
        archive = self.root / "release.tar.gz"
        with tarfile.open(archive, "w:gz") as bundle:
            bundle.add(self.previous / "package.json", arcname="package.json")
            bundle.add(self.worker, arcname="scripts/mint/select-offline-release.py")
        # A recovery worker must always be taken from the signed snapshot.
        self.worker.write_text("raise RuntimeError('Mutable worker dispatched')\n")
        private = self.root / "private.pem"
        public = self.root / "release-signing-public.pem"
        subprocess.run(["openssl", "genpkey", "-algorithm", "EC", "-pkeyopt",
                        "ec_paramgen_curve:P-256", "-out", str(private)], check=True)
        subprocess.run(["openssl", "pkey", "-in", str(private), "-pubout", "-out", str(public)], check=True)
        signed = self.root / "signed"
        signer.sign_release("linux-mint", "1.2.3", archive, private, public, signed)
        for name, target in (("manifest.json", ".ars-release-manifest.json"),
                             ("manifest.sig", ".ars-release-manifest.sig"),
                             ("release.tar.gz", ".ars-release.tar.gz")):
            (signed / name).rename(self.previous / target)
        (self.root / "project").symlink_to(self.candidate)
        hold = self.root / "maintenance-hold.json"
        self.intent = self.root / "runtime-switch-intent.json"
        self.journal = self.root / "switch-journal.json"
        hold.write_bytes(b"retained hold")
        self.intent.write_bytes(b"retained intent")
        self.record = {"schema": 1, "kind": "mint-offline-release-selection", "phase": "backup-verified",
                       "switchId": "a" * 32, "previous": str(self.previous), "candidate": str(self.candidate),
                       "intentDigest": hashlib.sha256(self.intent.read_bytes()).hexdigest(),
                       "maintenanceDigest": hashlib.sha256(hold.read_bytes()).hexdigest(),
                       "startupAllowed": False}
        self.write_journal()
        self.dispatch = self.root / "dispatch.json"

    def write_journal(self):
        self.journal.write_text(json.dumps(self.record))

    def test_resume_dispatches_verified_snapshot_with_observed_evidence(self):
        self.assertEqual(recovery.recover(self.root, "resume"), "rollback")
        args = json.loads(self.dispatch.read_text())
        self.assertEqual(args[:3], ["--rollback-offline", "--confirmation", "ROLL BACK OFFLINE RELEASE"])
        review = json.loads(args[4])
        self.assertEqual(review["activeProject"], str(self.candidate))
        self.assertEqual(review["switch-journal.json"], hashlib.sha256(self.journal.read_bytes()).hexdigest())
        self.assertTrue((self.root / "maintenance-hold.json").is_file())

    def test_recovery_rechecks_evidence_after_snapshot_preparation(self):
        from contextlib import contextmanager
        original = recovery.publisher_snapshot
        @contextmanager
        def changed(*args, **kwargs):
            with original(*args, **kwargs) as snapshot:
                self.journal.write_bytes(self.journal.read_bytes() + b" ")
                yield snapshot
        with patch.object(recovery, "publisher_snapshot", side_effect=changed):
            with self.assertRaisesRegex(ValueError, "changed before dispatch"):
                recovery.recover(self.root, "resume")
        self.assertFalse(self.dispatch.exists())

    def test_completed_selection_does_not_roll_back_automatically(self):
        self.record["phase"] = "switched"
        self.write_journal()
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            recovery.recover(self.root, "resume")
        with self.assertRaisesRegex(ValueError, "confirmation"):
            recovery.recover(self.root, "rollback")
        self.assertFalse(self.dispatch.exists())

    def test_bad_signature_and_changed_review_block_dispatch(self):
        with self.assertRaisesRegex(ValueError, "Operator-reviewed"):
            recovery.recover(self.root, "resume", expected_review={})
        signature = self.previous / ".ars-release-manifest.sig"
        signature.write_bytes(b"changed")
        with self.assertRaises(subprocess.CalledProcessError):
            recovery.recover(self.root, "resume")
        self.assertFalse(self.dispatch.exists())

    def test_pre_start_skips_completed_selection(self):
        self.record["phase"] = "switched"
        self.write_journal()
        with patch.object(recovery, "recover") as recover:
            recovery.recover_before_startup(self.root)
            recover.assert_not_called()

    def test_staged_release_without_any_signing_assets_cannot_open_mutable_ui(self):
        staged = self.root / "staged-releases/1.2.3"
        staged.mkdir(parents=True)
        self.record.update(previous=str(staged), phase="switched")
        self.write_journal()
        with patch.object(recovery, "show_update_center") as show:
            with self.assertRaises(FileNotFoundError):
                recovery.open_update_center(self.root)
            show.assert_not_called()

    def test_desktop_bootstrap_recovers_before_resolving_the_candidate(self):
        # This fixture has no Update Center in the candidate.
        with patch.object(recovery, "recover") as recover, patch.object(recovery.subprocess, "run") as command:
            recovery.open_update_center(self.root)
            recover.assert_called_once_with(self.root, "resume")
            self.assertEqual(command.call_args.args[0][0], "zenity")

    def test_restart_attempts_only_interrupted_selection_from_installed_tool(self):
        tools = self.root / "update-tools"
        tools.mkdir()
        stable = tools / "trusted-switch-recovery.py"
        stable.touch()
        with patch.object(center, "STATE", self.root), patch.object(center, "execute_command") as execute:
            self.assertTrue(center.resume_interrupted_selection())
            args = execute.call_args.args[1]
            self.assertEqual(args[-2:], [str(stable), "resume"])
            self.record["phase"] = "switched"
            self.write_journal()
            self.assertFalse(center.resume_interrupted_selection())
            self.assertEqual(execute.call_count, 1)


class InstalledRollbackTests(unittest.TestCase):
    @unittest.skipIf(os.geteuid() == 0, "The installed updater runs as the desktop user.")
    def test_installed_recovery_reverses_interrupted_pointer_and_keeps_maintenance(self):
        for signed in (True, False):
            with self.subTest(signed=signed):
                self.exercise_rollback(signed)

    def exercise_rollback(self, signed):
        from release_fingerprint import fingerprint, recovery_tools_fingerprint
        with tempfile.TemporaryDirectory(prefix="ars-offline-rollback-") as directory:
            home = Path(directory)
            state = home / ".local/share/ars-hardware"
            tools = state / "update-tools"
            tools.mkdir(parents=True)
            for name in ("trusted-switch-recovery.py", "signed_release_source.py"):
                shutil.copy2(HERE / name, tools / name)
            previous = state / "staged-releases/1.2.2" if signed else home / "original-installation"
            candidate = state / "staged-releases/1.2.3"
            previous_scripts = previous / "scripts/mint"
            previous_scripts.mkdir(parents=True)
            (previous / "package.json").write_text('{"version":"1.2.2"}')
            for name in ("select-offline-release.py", "prepare-switch-intent.py",
                         "prepare-runtime-activation.py", "switch_journal.py", "startup_guard.py",
                         "interrupted_switch.py", "maintenance_backup.py", "resume_maintenance.py", "switch_coordinator.py", "switch_coordinator.py",
                         "release_fingerprint.py", "signed_release_source.py", "compose.yaml"):
                shutil.copy2(HERE / name, previous_scripts / name)
            if signed:
                archive = home / "release.tar.gz"
                with tarfile.open(archive, "w:gz") as bundle:
                    bundle.add(previous / "package.json", arcname="package.json")
                    bundle.add(previous / "scripts", arcname="scripts")
                private = home / "private.pem"
                public = state / "release-signing-public.pem"
                subprocess.run(["openssl", "genpkey", "-algorithm", "EC", "-pkeyopt",
                                "ec_paramgen_curve:P-256", "-out", str(private)], check=True)
                subprocess.run(["openssl", "pkey", "-in", str(private), "-pubout", "-out", str(public)], check=True)
                assets = home / "signed"
                signer.sign_release("linux-mint", "1.2.2", archive, private, public, assets)
                for name, target in (("manifest.json", ".ars-release-manifest.json"),
                                     ("manifest.sig", ".ars-release-manifest.sig"),
                                     ("release.tar.gz", ".ars-release.tar.gz")):
                    (assets / name).rename(previous / target)
            else:
                manifest = {
                    "scripts/mint/" + name: {"sha256": hashlib.sha256((previous_scripts / name).read_bytes()).hexdigest()}
                    for name in recovery.INITIAL_FILES
                }
                (previous / "PILOT-FILES.json").write_text(json.dumps(manifest))
                pointer = state / "project"
                pointer.symlink_to(previous)
                command = ["/usr/bin/python3", "-E", "-s", "-B", str(tools / "trusted-switch-recovery.py")]
                subprocess.run([*command, "install-initial", "--initial-project", str(previous)],
                               env={**os.environ, "HOME": str(home)}, check=True, timeout=30)
                pointer.unlink()

            runtime = state / "runtime"
            runtime.mkdir()
            (runtime / ".env.local").write_text("fixture")
            (runtime / "backups").mkdir()
            (runtime / "uploads").mkdir()
            data = runtime / "uploads/sample.txt"
            data.write_text("existing business data")
            for release in (previous, candidate):
                (release / "dist").mkdir(parents=True)
                (release / "dist/server.cjs").write_text("throw Error('POS must stay stopped');")
                (release / "node_modules").mkdir()
                for name in (".env.local", "backups", "uploads"):
                    (release / name).symlink_to(runtime / name)
            build = home / "previous-build"
            for name in ("dist", "node_modules"):
                shutil.copytree(previous / name, build / name)
            hold = state / "maintenance-hold.json"
            hold.write_text(json.dumps({"purpose": "pre-update backup", "previousProject": str(previous)}))
            proposal = state / "runtime-activation-proposal.json"
            proposal.write_bytes(b"protected proposal originally verified")
            digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
            switch_id = "b" * 32
            intent = state / "runtime-switch-intent.json"
            intent.write_text(json.dumps({
                "schema": 1, "kind": "mint-runtime-switch-intent", "switchId": switch_id,
                "observationOnly": True, "activationAllowed": False, "startupAllowed": False,
                "rollbackAllowed": False, "runtimeActivated": False,
                "binding": {"previousProject": str(previous), "candidateVersion": "1.2.3",
                            "desktopUid": os.getuid(), "previousBuildDigest": fingerprint(build),
                            "previousRecoveryToolsDigest": recovery_tools_fingerprint(previous),
                            "proposalDigest": digest(proposal), "maintenanceDigest": digest(hold)},
            }))
            journal = state / "switch-journal.json"
            journal.write_text(json.dumps({
                "schema": 1, "kind": "mint-offline-release-selection", "phase": "backup-verified",
                "switchId": switch_id, "previous": str(previous), "candidate": str(candidate),
                "intentDigest": digest(intent), "maintenanceDigest": digest(hold), "startupAllowed": False,
            }))
            pointer = state / "project"
            pointer.symlink_to(candidate)

            # Host integration stubs affirm a stopped service and zero clients.
            # Any service mutation or Compose file outside the signed snapshot fails.
            commands = home / "commands"
            commands.mkdir()
            scripts = {
                "systemctl": """#!/bin/sh
[ "$1 $2" = "--user show" ] || exit 1
case "$ARS_SERVICE_FIXTURE" in
starting)
    control_pid=$(ps -o ppid= -p "$PPID" | tr -d ' ')
    printf 'ActiveState=activating\nSubState=condition\nMainPID=0\nControlPID=%s\n' "$control_pid" ;;
unrelated)
    printf 'ActiveState=activating\nSubState=condition\nMainPID=0\nControlPID=1\n' ;;
*)
    printf 'ActiveState=inactive\nSubState=dead\nMainPID=0\n' ;;
esac
""",
                "docker": '#!/bin/sh\n[ "$1" = compose ] || exit 1\ncase "$7" in */ars-publisher-*/source/scripts/mint/compose.yaml|*/ars-initial-recovery-*/compose.yaml) printf "0\n";; *) exit 1;; esac\n',
            }
            for name, source in scripts.items():
                path = commands / name
                path.write_text(source)
                path.chmod(0o700)
            env = {**os.environ, "HOME": str(home), "PATH": str(commands) + ":" + os.environ["PATH"]}
            command = ["/usr/bin/python3", "-E", "-s", "-B", str(tools / "trusted-switch-recovery.py")]
            original_hold = hold.read_bytes()
            rejected = subprocess.run([*command, "pre-start"], env={**env, "ARS_SERVICE_FIXTURE": "unrelated"},
                                      capture_output=True, timeout=30)
            self.assertEqual(rejected.returncode, 1)
            self.assertEqual(pointer.resolve(), candidate)
            self.assertEqual(json.loads(journal.read_text())["phase"], "backup-verified")
            if not signed:
                cached = tools / "initial-release/maintenance_backup.py"
                original = cached.read_bytes()
                cached.write_bytes(original + b"\n# unexpected edit\n")
                rejected = subprocess.run([*command, "pre-start"], env={**env, "ARS_SERVICE_FIXTURE": "starting"},
                                          capture_output=True, timeout=30)
                self.assertEqual(rejected.returncode, 1)
                self.assertEqual(pointer.resolve(), candidate)
                cached.write_bytes(original)
            subprocess.run([*command, "pre-start"], env={**env, "ARS_SERVICE_FIXTURE": "starting"},
                           check=True, capture_output=True, timeout=30)
            self.assertEqual(pointer.resolve(), previous)
            self.assertEqual(json.loads(journal.read_text())["phase"], "offline-rolled-back")
            self.assertEqual(hold.read_bytes(), original_hold)
            subprocess.run([*command, "resume"], env=env, check=True, capture_output=True, timeout=30)
            self.assertFalse(journal.exists())
            self.assertTrue((state / ("rolled-back-journal-" + switch_id + ".json")).is_file())
            self.assertEqual(hold.read_bytes(), original_hold)
            self.assertEqual(data.read_text(), "existing business data")


if __name__ == "__main__":
    unittest.main()
