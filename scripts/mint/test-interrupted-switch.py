import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
import json
import resume_maintenance as resume
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
    def test_resume_preserves_hold_when_external_database_client_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            project=root/"project"
            project.mkdir()
            hold=root/"maintenance-hold.json"
            saved=json.dumps({"purpose":"pre-update backup","previousProject":str(project)}).encode()
            hold.write_bytes(saved)
            with patch.object(resume,"STATE",root), patch.object(resume.os,"geteuid",return_value=1000), patch.object(resume,"stopped"), patch.object(resume,"check_database_clients",side_effect=RuntimeError("External client")), patch.object(resume.subprocess,"run") as service:
                with self.assertRaisesRegex(RuntimeError,"External client"):
                    resume.resume("RESUME CURRENT POS")
                service.assert_not_called()
            self.assertEqual(hold.read_bytes(),saved)
    def test_resume_rejects_linked_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            target=root/"target"
            target.write_text("preserve")
            lock=root/"maintenance.lock"
            lock.symlink_to(target)
            with self.assertRaises(OSError):
                resume.open_lock(lock)
            self.assertEqual(target.read_text(),"preserve")
    def test_missing_journal(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(recovery_plan(tmp)["action"],"manual-review")

if __name__=="__main__":
    unittest.main()
