"""Disposable repair switch rehearsal using the existing production pointer primitive."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from repair_interruption import FLAGS, MARKER, make_record, retain_marker, inspect
from release_fingerprint import fingerprint
from startup_guard import startup_allowed
from switch_journal import switch_pointer, write_journal
from interrupted_switch import recovery_plan

class Tests(unittest.TestCase):
    def test_switch_and_rollback_after_interruption(self):
        # Each cut point gets an independent filesystem fixture. No actual service,
        # installation, database, credentials or user files are accessed.
        for cut in ("before-switch","after-pointer","after-journal","during-rollback"):
            with self.subTest(cut=cut), tempfile.TemporaryDirectory(prefix="ars-repair-switch-ci-") as folder:
                state=Path(folder)
                previous=state/"previous"
                candidate=state/"candidate"
                runtime=state/"runtime"
                repair=state/"repair-preparation-test"
                for release,content in ((previous,"previous fixture"),(candidate,"candidate fixture")):
                    (release/"dist").mkdir(parents=True)
                    (release/"dist/server.cjs").write_text(content)
                    (release/"dist/index.html").write_text(content)
                runtime.mkdir()
                (runtime/".env.local").write_text("SYNTHETIC_FIXTURE=true")
                for name in ("uploads","backups"):
                    (runtime/name).mkdir()
                    (runtime/name/"fixture.txt").write_text(name)
                for release in (previous,candidate):
                    for name in (".env.local","uploads","backups"):
                        (release/name).symlink_to(runtime/name)
                pointer=state/"project"
                pointer.symlink_to(previous,target_is_directory=True)
                old=fingerprint(previous,runtime)
                new=fingerprint(candidate,runtime)
                storage=fingerprint(runtime)
                repair.mkdir()
                raw=json.dumps(dict(schema=1,kind="mint-repair-rollback-preparation",repairSpecificRollbackTested=True,previousBuildFingerprint=old,repairBuildFingerprint=new,**FLAGS)).encode()
                (repair/"rollback-preparation.json").write_bytes(raw)
                self.assertTrue(startup_allowed(state))
                retain_marker(state,make_record(repair.name,hashlib.sha256(raw).hexdigest()))
                marker=(state/MARKER).read_bytes()
                journal=dict(schema=1,kind="mint-offline-release-selection",phase="backup-verified",previous=str(previous),candidate=str(candidate),startupAllowed=False)
                write_journal(state,journal)
                if cut!="before-switch":
                    switch_pointer(pointer,previous,candidate)
                    self.assertEqual(pointer.resolve(),candidate)
                if cut in ("after-journal","during-rollback"):
                    journal["phase"]="switched"
                    write_journal(state,journal)
                if cut=="during-rollback":
                    journal["phase"]="offline-rollback-pending"
                    write_journal(state,journal)
                    switch_pointer(pointer,candidate,previous)
                # Treat each cut point as a restart: read persisted evidence rather
                # than relying on the in-memory journal to determine the pointer.
                persisted=json.loads((state/"switch-journal.json").read_text())
                self.assertEqual(recovery_plan(state)["action"],"hold-for-review")
                self.assertFalse(startup_allowed(state))
                self.assertTrue(inspect(state)["rollbackReceiptMatched"])
                self.assertEqual(fingerprint(previous,runtime),old)
                self.assertEqual(fingerprint(candidate,runtime),new)
                self.assertEqual(fingerprint(runtime),storage)
                # Rehearse only the offline pointer reversal, never clear blockers.
                persisted["phase"]="offline-rollback-pending"
                write_journal(state,persisted)
                if pointer.resolve()==candidate:
                    switch_pointer(pointer,candidate,previous)
                persisted["phase"]="offline-rolled-back"
                write_journal(state,persisted)
                self.assertEqual(pointer.resolve(),previous)
                self.assertFalse(startup_allowed(state))
                self.assertEqual((state/MARKER).read_bytes(),marker)
                self.assertEqual(fingerprint(runtime),storage)
                self.assertEqual(fingerprint(previous,runtime),old)
                self.assertEqual(fingerprint(candidate,runtime),new)
                # A stale expected pointer cannot change the selected build.
                with self.assertRaises(ValueError):
                    switch_pointer(pointer,candidate,previous)
                self.assertEqual(pointer.resolve(),previous)
                # Missing executable blocks a fresh selection.
                (candidate/"dist/server.cjs").unlink()
                with self.assertRaises(ValueError):
                    switch_pointer(pointer,previous,candidate)
                self.assertEqual(pointer.resolve(),previous)
                self.assertFalse(startup_allowed(state))

if __name__=="__main__":
    unittest.main()
