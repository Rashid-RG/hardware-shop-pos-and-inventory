import tempfile
from pathlib import Path
import unittest
from switch_journal import write_journal,switch_pointer
from interrupted_switch import recovery_plan
from startup_guard import startup_allowed

class RecoveryTests(unittest.TestCase):
    def test_interrupted_and_completed_switch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            old=root/"old"
            new=root/"new"
            for release in (old,new):
                (release/"dist").mkdir(parents=True)
                (release/"dist/server.cjs").touch()
            pointer=root/"project"
            pointer.symlink_to(old)
            record={"previous":str(old),"candidate":str(new),"phase":"backup-verified"}
            write_journal(root,record)
            self.assertEqual(recovery_plan(root)["action"],"hold-for-review")
            switch_pointer(pointer,old,new)
            self.assertEqual(recovery_plan(root)["action"],"hold-for-review")
            record["phase"]="completed"
            write_journal(root,record)
            self.assertEqual(recovery_plan(root)["action"],"verify-current")
            switch_pointer(pointer,new,old)
            self.assertEqual(recovery_plan(root)["action"],"manual-review")
            record["phase"]="rolled-back"
            write_journal(root,record)
            self.assertEqual(recovery_plan(root)["action"],"verify-previous")
    def test_startup_blocked_by_retained_update_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            self.assertTrue(startup_allowed(root))
            for name in ("runtime-switch-intent.json","maintenance-hold.json","runtime-activation-interrupted.json","handoff-pending.json"):
                marker=root/name
                marker.touch()
                self.assertFalse(startup_allowed(root))
                marker.unlink()
                marker.symlink_to(root/"missing")
                self.assertFalse(startup_allowed(root))
                marker.unlink()
            self.assertTrue(startup_allowed(root))
    def test_missing_journal(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(recovery_plan(tmp)["action"],"manual-review")

if __name__=="__main__":
    unittest.main()
