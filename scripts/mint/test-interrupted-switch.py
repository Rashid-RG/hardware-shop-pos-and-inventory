import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
import json
import importlib.util
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
    def test_fresh_installer_refuses_registered_installation_and_recovery_evidence(self):
        spec=importlib.util.spec_from_file_location("runtime_layout",Path(__file__).with_name("runtime-layout.py"))
        layout=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(layout)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            project=root/"release"
            project.mkdir()
            state=root/"state"
            state.mkdir()
            with patch.object(layout,"STATE",state), patch.object(layout,"RUNTIME",state/"runtime"), patch.object(layout.os,"geteuid",return_value=1000):
                active=state/"project"
                active.symlink_to(project)
                with self.assertRaisesRegex(ValueError,"already registered"):
                    layout.prepare(project)
                self.assertFalse((state/"runtime").exists())
                active.unlink()
                active.symlink_to(root/"missing")
                with self.assertRaisesRegex(ValueError,"already registered"):
                    layout.prepare(project)
                active.unlink()
                marker=state/"maintenance-hold.json"
                marker.write_text("preserve")
                with self.assertRaisesRegex(ValueError,"recovery evidence"):
                    layout.prepare(project)
                self.assertEqual(marker.read_text(),"preserve")
                self.assertFalse((state/"runtime").exists())
    def test_runtime_inventory_preserves_legacy_credentials_and_reports_conflict(self):
        spec=importlib.util.spec_from_file_location("runtime_layout",Path(__file__).with_name("runtime-layout.py"))
        layout=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(layout)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            state=root/"state"
            state.mkdir()
            project=root/"release"
            project.mkdir()
            runtime=state/"runtime"
            runtime.mkdir()
            (state/"project").symlink_to(project)
            (project/".env.local").write_text("private-fixture")
            (project/"uploads").mkdir()
            (runtime/"uploads").mkdir()
            (project/"backups").symlink_to(root/"missing")
            with patch.object(layout,"STATE",state), patch.object(layout,"RUNTIME",runtime):
                result=layout.migration_inventory(project)
            self.assertEqual([e["status"] for e in result["entries"]],["legacy-source","destination-conflict","unsafe-link"])
            self.assertFalse(result["migrationAllowed"])
            self.assertNotIn("private-fixture",json.dumps(result))
            self.assertEqual((project/".env.local").read_text(),"private-fixture")
            self.assertFalse((runtime/".env.local").exists())
    def test_legacy_copy_verifies_bytes_without_removing_originals(self):
        spec=importlib.util.spec_from_file_location("runtime_layout",Path(__file__).with_name("runtime-layout.py"))
        layout=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(layout)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            source=root/"legacy"
            source.mkdir()
            (source/".env.local").write_bytes(b"fixture-secret")
            (source/"uploads").mkdir()
            (source/"uploads"/"image").write_bytes(b"image")
            (source/"backups").mkdir()
            (source/"backups"/"archive").write_bytes(b"archive")
            target=root/"copy"
            result=layout.copy_legacy_storage(source,target)
            self.assertEqual(result,{"verified":True,"files":3,"activationAllowed":False})
            self.assertEqual((source/".env.local").read_bytes(),(target/".env.local").read_bytes())
            self.assertEqual((target/".env.local").stat().st_mode & 0o777,0o600)
            with self.assertRaises(ValueError):
                layout.copy_legacy_storage(source,target)
            (source/"uploads"/"linked").symlink_to(root/"missing")
            with self.assertRaises(ValueError):
                layout.copy_legacy_storage(source,root/"rejected")
            self.assertFalse((root/"rejected").exists())
    def test_migration_stage_requires_explicit_approval(self):
        spec=importlib.util.spec_from_file_location("runtime_layout",Path(__file__).with_name("runtime-layout.py"))
        layout=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(layout)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            with patch.object(layout.os,"geteuid",return_value=1000):
                with self.assertRaisesRegex(ValueError,"approval"):
                    layout.stage_migration(root,root,"")
            self.assertEqual(list(root.iterdir()),[])
    def test_staged_runtime_detects_changed_source_and_copy(self):
        spec=importlib.util.spec_from_file_location("runtime_layout",Path(__file__).with_name("runtime-layout.py"))
        layout=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(layout)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            source=root/"legacy"
            source.mkdir()
            (source/".env.local").write_text("fixture")
            (source/"uploads").mkdir()
            (source/"uploads"/"photo").write_text("original")
            (source/"backups").mkdir()
            destination=root/"staged"
            layout.copy_legacy_storage(source,destination)
            digest=layout.verify_staged_storage(source,destination)
            self.assertRegex(digest,r"^[a-f0-9]{64}$")
            (destination/"uploads"/"photo").write_text("modified")
            with self.assertRaisesRegex(ValueError,"differs"):
                layout.verify_staged_storage(source,destination)
            (destination/"uploads"/"photo").write_text("original")
            (source/".env.local").write_text("changed")
            with self.assertRaisesRegex(ValueError,"differs"):
                layout.verify_staged_storage(source,destination)
    def test_runtime_mapping_and_partial_failure_preserve_originals(self):
        spec=importlib.util.spec_from_file_location("runtime_layout",Path(__file__).with_name("runtime-layout.py"))
        layout=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(layout)
        for failure in (None,1,2,3):
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp)
                source=root/"legacy"
                source.mkdir()
                (source/".env.local").write_text("fixture")
                (source/"uploads").mkdir()
                (source/"uploads"/"photo").write_text("image")
                (source/"backups").mkdir()
                layout.copy_legacy_storage(source,root/"staged")
                with self.assertRaisesRegex(ValueError,"Disposable"):
                    layout.rehearse_runtime_mapping(root)
                (root/".ars-runtime-test").touch()
                if failure is None:
                    self.assertTrue(layout.rehearse_runtime_mapping(root)["mapped"])
                    self.assertTrue((source/".env.local").is_symlink())
                    self.assertEqual((root/"originals"/".env.local").read_text(),"fixture")
                else:
                    with self.assertRaisesRegex(RuntimeError,"Injected"):
                        layout.rehearse_runtime_mapping(root,failure)
                    self.assertFalse((source/".env.local").is_symlink())
                    self.assertEqual((source/"uploads"/"photo").read_text(),"image")
                    self.assertEqual((root/"runtime"/".env.local").read_text(),"fixture")
    def test_missing_journal(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(recovery_plan(tmp)["action"],"manual-review")

if __name__=="__main__":
    unittest.main()
