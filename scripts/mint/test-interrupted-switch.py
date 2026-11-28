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
            for name in ("runtime-switch-intent.json","maintenance-hold.json","runtime-activation-interrupted.json","handoff-pending.json","runtime-migration-interrupted.json"):
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

    def test_resume_keeps_original_hold_and_stops_a_wrong_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            release = state / "installed"
            release.mkdir()
            (release / "package.json").write_text('{"version":"1.2.3"}')
            (state / "project").symlink_to(release)
            hold = state / "maintenance-hold.json"
            saved = json.dumps({"purpose":"pre-update backup", "previousProject":str(release)}).encode()
            hold.write_bytes(saved)
            with patch.object(resume, "STATE", state), patch.object(resume.os, "geteuid", return_value=1000), patch.object(resume, "stopped"), patch.object(resume, "check_database_clients"), patch.object(resume.subprocess, "run") as service:
                with patch.object(resume, "wait_for_current_release", side_effect=RuntimeError("wrong release")) as verify:
                    with self.assertRaisesRegex(RuntimeError, "wrong release"):
                        resume.resume("RESUME CURRENT POS")
                    verify.assert_called_once_with(release, "1.2.3")
                self.assertEqual([call.args[0][2] for call in service.call_args_list], ["start", "stop"])
            self.assertEqual(hold.read_bytes(), saved)
            import hashlib
            archive=state/("resume-hold-"+hashlib.sha256(saved).hexdigest()+".json")
            self.assertEqual(archive.read_bytes(),saved)
            archive.write_bytes(b"tampered")
            with patch.object(resume,"STATE",state), patch.object(resume.os,"geteuid",return_value=1000), patch.object(resume,"stopped"), patch.object(resume,"check_database_clients"), patch.object(resume.subprocess,"run") as service:
                with self.assertRaisesRegex(ValueError,"archive differs"):
                    resume.resume("RESUME CURRENT POS")
                service.assert_not_called()
            self.assertEqual(hold.read_bytes(),saved)

    def test_readiness_requires_exact_version_pid_and_stable_service(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            release = state / "project"
            release.mkdir()
            body = {"ok": True, "status": "ready", "database": "reachable",
                    "sourceOfTruth": "normalized", "buildVersion": "1.2.3", "processId": 101}
            for observed, pids, error in (
                (body, [(101, "1234"), (101, "1234")], None),
                ({**body, "buildVersion": "1.9.0"}, [(101, "1234")], "another POS process or release"),
                ({**body, "processId": 102}, [(101, "1234")], "another POS process or release"),
                (body, [(101, "1234"), (101, "5678")], "changed during readiness"),
            ):
                with self.subTest(observed=observed, pids=pids), patch.object(resume, "STATE", state), patch.object(resume, "active_process", side_effect=pids), patch.object(resume, "build_opener") as opener:
                    response = opener.return_value.open.return_value.__enter__.return_value
                    response.read.return_value = json.dumps(observed).encode()
                    if error:
                        with self.assertRaisesRegex(RuntimeError, error):
                            resume.wait_for_current_release(release, "1.2.3", timeout=1)
                    else:
                        resume.wait_for_current_release(release, "1.2.3", timeout=1)
                    response.read.assert_called_once_with(16385)
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
    def test_mapping_entry_point_retains_hold_and_originals(self):
        import hashlib
        import maintenance_backup
        spec=importlib.util.spec_from_file_location("runtime_layout",Path(__file__).with_name("runtime-layout.py"))
        layout=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(layout)
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp)
            project=state/"release"
            project.mkdir()
            (state/"project").symlink_to(project)
            (project/".env.local").write_text("fixture")
            (project/"uploads").mkdir()
            (project/"backups").mkdir()
            staged=state/"runtime-migration-staged"
            layout.copy_legacy_storage(project,staged)
            digest=layout.verify_staged_storage(project,staged)
            hold=state/"maintenance-hold.json"
            raw=json.dumps({"purpose":"pre-update backup","previousProject":str(project)}).encode()
            hold.write_bytes(raw)
            (staged/"migration-receipt.json").write_text(json.dumps({"schema":1,"kind":"mint-runtime-migration-staged","source":str(project),"storageDigest":digest,"holdDigest":hashlib.sha256(raw).hexdigest(),"activationAllowed":False}))
            with patch.object(layout,"STATE",state), patch.object(layout,"RUNTIME",state/"runtime"), patch.object(layout.os,"geteuid",return_value=1000), patch.object(maintenance_backup,"stopped"), patch.object(maintenance_backup,"check_database_clients"):
                with self.assertRaisesRegex(ValueError,"approval"):
                    layout.map_staged_runtime(project,"")
                result=layout.map_staged_runtime(project,"MAP VERIFIED RUNTIME")
            self.assertTrue(result["mapped"])
            self.assertFalse(result["startupAllowed"])
            self.assertEqual(hold.read_bytes(),raw)
            self.assertFalse(startup_allowed(state))
            self.assertEqual((state/"runtime-migration-originals"/".env.local").read_text(),"fixture")
            self.assertEqual((project/".env.local").resolve(),state/"runtime"/".env.local")
    def test_startup_rejects_incomplete_migration_mapping(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            project=root/"release"
            project.mkdir()
            (root/"project").symlink_to(project)
            originals=root/"runtime-migration-originals"
            originals.mkdir()
            runtime=root/"runtime"
            runtime.mkdir()
            self.assertFalse(startup_allowed(root))
            digest="a"*64
            (runtime/"migration-receipt.json").write_text(json.dumps({"schema":1,"kind":"mint-runtime-migration-staged","activationAllowed":False,"storageDigest":digest}))
            (runtime/"mapping-complete.json").write_text(json.dumps({"schema":1,"storageDigest":digest,"originalsRetained":True,"startupAllowed":False}))
            for name in (".env.local","uploads","backups"):
                for folder in (runtime,originals):
                    if name==".env.local":
                        (folder/name).write_text("fixture")
                    else:
                        (folder/name).mkdir()
                (project/name).symlink_to(runtime/name)
            self.assertTrue(startup_allowed(root))
            (runtime/"uploads"/"new-photo").write_text("normal business change")
            self.assertTrue(startup_allowed(root))
            (project/"uploads").unlink()
            self.assertFalse(startup_allowed(root))
    def test_interrupted_mapping_can_finish_without_removing_hold(self):
        import hashlib
        import maintenance_backup
        spec=importlib.util.spec_from_file_location("runtime_layout",Path(__file__).with_name("runtime-layout.py"))
        layout=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(layout)
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp)
            project=state/"release"
            project.mkdir()
            (state/"project").symlink_to(project)
            (project/".env.local").write_text("fixture")
            (project/"uploads").mkdir()
            (project/"backups").mkdir()
            runtime=state/"runtime"
            layout.copy_legacy_storage(project,runtime)
            digest=layout.verify_staged_storage(project,runtime)
            hold=state/"maintenance-hold.json"
            raw=json.dumps({"purpose":"pre-update backup","previousProject":str(project)}).encode()
            hold.write_bytes(raw)
            (runtime/"migration-receipt.json").write_text(json.dumps({"schema":1,"kind":"mint-runtime-migration-staged","source":str(project),"storageDigest":digest,"holdDigest":hashlib.sha256(raw).hexdigest(),"activationAllowed":False}))
            marker=state/"runtime-migration-interrupted.json"
            marker.write_text(json.dumps({"schema":1,"kind":"mint-runtime-mapping-interrupted","source":str(project),"storageDigest":digest,"startupAllowed":False}))
            originals=state/"runtime-migration-originals"
            originals.mkdir()
            (project/".env.local").rename(originals/".env.local")
            self.assertFalse((project/".env.local").exists())
            with patch.object(layout,"STATE",state), patch.object(layout,"RUNTIME",runtime), patch.object(layout.os,"geteuid",return_value=1000), patch.object(maintenance_backup,"stopped"), patch.object(maintenance_backup,"check_database_clients") as clients:
                result=layout.recover_interrupted_mapping(project,"RECOVER RUNTIME MAPPING")
                self.assertEqual(clients.call_args_list[0].kwargs,{"env_file":runtime/".env.local"})
                self.assertEqual(clients.call_count,2)
            self.assertTrue(result["mapped"])
            self.assertEqual(hold.read_bytes(),raw)
            self.assertFalse(marker.exists())
            self.assertFalse(startup_allowed(state))
            self.assertEqual((originals/".env.local").read_text(),"fixture")
            self.assertEqual((project/"uploads").resolve(),runtime/"uploads")
    def test_migration_menu_recovery_requires_confirmation(self):
        from types import SimpleNamespace
        spec=importlib.util.spec_from_file_location("update_center",Path(__file__).with_name("update-center.py"))
        center=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(center)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/"runtime-migration-interrupted.json").touch()
            answers=[SimpleNamespace(returncode=0,stdout="Recover interrupted mapping"),SimpleNamespace(returncode=1,stdout=""),SimpleNamespace(returncode=0,stdout="Recover interrupted mapping"),SimpleNamespace(returncode=0,stdout=""),SimpleNamespace(returncode=0,stdout="Return")]
            with patch.object(center,"STATE",root), patch.object(center,"dialog",side_effect=answers), patch.object(center,"execute") as execute:
                center.runtime_migration_center(root)
                execute.assert_called_once_with(root,"runtime-layout.py",str(root),"--recover-mapping","--confirmation","RECOVER RUNTIME MAPPING")
    def test_database_client_check_uses_verified_configuration_without_changing_compose_project(self):
        import maintenance_backup
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            project=root/"release"
            project.mkdir()
            config=root/"verified.env"
            config.write_text("fixture")
            with patch.object(maintenance_backup.subprocess,"run",return_value=SimpleNamespace(stdout="0")) as run:
                maintenance_backup.check_database_clients(project,env_file=config)
                cmd=run.call_args.args[0]
                self.assertEqual(cmd[cmd.index("--env-file")+1],str(config))
                self.assertEqual(run.call_args.kwargs["cwd"],project)
                self.assertEqual(cmd[cmd.index("-p")+1],"ars-mint")
                self.assertFalse((project/".env.local").exists())
    def test_update_preflight_requires_working_previous_version_reads_and_writes(self):
        spec=importlib.util.spec_from_file_location("update_plan",Path(__file__).with_name("update-switch-plan.py"))
        plan=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(plan)
        flags={"backwardStartupPassed":True,"backwardReadsPassed":True,"backwardWritesPassed":True}
        plan.verify_backward_compatibility(flags)
        for flag in flags:
            for value in (None,False,"true"):
                with self.subTest(flag=flag,value=value), self.assertRaisesRegex(ValueError,"Previous-version startup"):
                    plan.verify_backward_compatibility({**flags,flag:value})

    def test_update_preflight_rejects_interrupted_runtime_migration(self):
        spec=importlib.util.spec_from_file_location("update_plan",Path(__file__).with_name("update-switch-plan.py"))
        plan=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(plan)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            marker=root/"runtime-migration-interrupted.json"
            marker.symlink_to(root/"missing")
            with patch.object(plan,"STATE",root), patch.object(plan.subprocess,"run") as run:
                with self.assertRaisesRegex(ValueError,"Resolve runtime migration"):
                    plan.plan(root/"unused")
                run.assert_not_called()
            self.assertTrue(marker.is_symlink())
    def test_candidate_mapping_preserves_existing_runtime_and_conflicts(self):
        spec=importlib.util.spec_from_file_location("switch_intent",Path(__file__).with_name("prepare-switch-intent.py"))
        intent=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(intent)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            candidate=root/"candidate"
            runtime=root/"runtime"
            candidate.mkdir()
            runtime.mkdir()
            (runtime/".env.local").write_text("fixture")
            (runtime/"uploads").mkdir()
            (runtime/"backups").mkdir()
            (candidate/"backups").mkdir()
            with self.assertRaisesRegex(ValueError,"conflict"):
                intent.prepare_candidate_runtime(candidate,runtime)
            self.assertFalse((candidate/".env.local").exists())
            (candidate/"backups").rmdir()
            intent.prepare_candidate_runtime(candidate,runtime)
            intent.prepare_candidate_runtime(candidate,runtime)
            for name in (".env.local","uploads","backups"):
                self.assertTrue((candidate/name).is_symlink())
                self.assertEqual((candidate/name).resolve(),runtime/name)
            self.assertEqual((runtime/".env.local").read_text(),"fixture")
    def test_offline_selection_retains_startup_blockers(self):
        import hashlib
        import maintenance_backup
        from types import SimpleNamespace
        spec=importlib.util.spec_from_file_location("switch_intent",Path(__file__).with_name("prepare-switch-intent.py"))
        intent=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(intent)
        selector_spec=importlib.util.spec_from_file_location("offline_selector",Path(__file__).with_name("select-offline-release.py"))
        selector=importlib.util.module_from_spec(selector_spec)
        selector_spec.loader.exec_module(selector)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            previous=root/"previous"
            candidate=root/"staged-releases"/"1.2.3"
            for release in (previous,candidate):
                (release/"dist").mkdir(parents=True)
                (release/"dist/server.cjs").touch()
            runtime=root/"runtime"
            runtime.mkdir()
            (runtime/".env.local").write_text("fixture")
            (runtime/"uploads").mkdir()
            (runtime/"backups").mkdir()
            (root/"project").symlink_to(previous)
            hold=root/"maintenance-hold.json"
            hold.write_text("fixture hold")
            sha=lambda raw:hashlib.sha256(raw).hexdigest()
            binding={"previousProject":str(previous),"candidateVersion":"1.2.3","maintenanceDigest":sha(hold.read_bytes())}
            target=root/"runtime-switch-intent.json"
            target.write_text(json.dumps({"schema":1,"kind":"mint-runtime-switch-intent","switchId":"a"*32,"observationOnly":True,"binding":binding,**intent.FLAGS}))
            raw=target.read_bytes()
            proposal=SimpleNamespace(plain=lambda *args:None,read=lambda path:path.read_bytes(),sha=sha)
            with patch.object(selector,"STATE",root), patch.object(selector,"load_intent",return_value=intent), patch.object(intent,"STATE",root), patch.object(intent.os,"geteuid",return_value=1000), patch.object(intent,"load",return_value=proposal), patch.object(intent,"verified_binding",return_value=binding), patch.object(maintenance_backup,"stopped"), patch.object(maintenance_backup,"check_database_clients"):
                with self.assertRaisesRegex(ValueError,"approval"):
                    selector.select_offline_release(root,"")
                # Candidate selected, post-switch shutdown or DB verification interrupted.
                # A durable pre-switch phase must survive with the candidate pointer.
                with patch.object(maintenance_backup,"stopped",side_effect=[None,OSError("power loss")]):
                    with self.assertRaisesRegex(OSError,"power loss"):
                        selector.select_offline_release(root,"SELECT OFFLINE RELEASE")
                journal=root/"switch-journal.json"
                self.assertEqual(json.loads(journal.read_text())["phase"],"backup-verified")
                self.assertEqual((root/"project").resolve(),candidate)
                self.assertFalse(startup_allowed(root))
                journal.unlink()
                (root/"project").unlink()
                (root/"project").symlink_to(previous)
                result=selector.select_offline_release(root,"SELECT OFFLINE RELEASE")
            self.assertTrue(result["selected"])
            self.assertFalse(result["startupAllowed"])
            self.assertEqual((root/"project").resolve(),candidate)
            self.assertEqual(target.read_bytes(),raw)
            self.assertEqual(hold.read_text(),"fixture hold")
            self.assertEqual(json.loads((root/"switch-journal.json").read_text())["phase"],"switched")
            self.assertFalse(startup_allowed(root))
    def test_offline_rollback_restores_previous_pointer_without_startup(self):
        import hashlib
        import os
        import maintenance_backup
        from release_fingerprint import fingerprint
        from types import SimpleNamespace
        spec=importlib.util.spec_from_file_location("intent",Path(__file__).with_name("prepare-switch-intent.py"))
        intent=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(intent)
        spec=importlib.util.spec_from_file_location("selector",Path(__file__).with_name("select-offline-release.py"))
        selector=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(selector)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            previous=root/"previous"
            candidate=root/"staged-releases"/"1.2.3"
            for release in (previous,candidate):
                (release/"dist").mkdir(parents=True)
                (release/"dist/server.cjs").write_text("fixture")
                (release/"node_modules").mkdir()
            runtime=root/"runtime"
            runtime.mkdir()
            (runtime/".env.local").write_text("fixture")
            (runtime/"uploads").mkdir()
            (runtime/"backups").mkdir()
            intent.prepare_candidate_runtime(previous,runtime)
            intent.prepare_candidate_runtime(candidate,runtime)
            (root/"project").symlink_to(candidate)
            hold=root/"maintenance-hold.json"
            hold.write_text(json.dumps({"purpose":"pre-update backup","previousProject":str(previous)}))
            sha=lambda raw:hashlib.sha256(raw).hexdigest()
            with tempfile.TemporaryDirectory() as build:
                import shutil
                for part in ("dist","node_modules"):
                    shutil.copytree(previous/part,Path(build)/part)
                digest=fingerprint(Path(build))
            proposal_path=root/"runtime-activation-proposal.json"
            proposal_path.write_text("fixture proposal")
            from release_fingerprint import recovery_tools_fingerprint
            (previous/"scripts").mkdir()
            helper=previous/"scripts/helper.py"
            helper.write_text("original")
            binding={"previousProject":str(previous),"candidateVersion":"1.2.3","maintenanceDigest":sha(hold.read_bytes()),"desktopUid":os.getuid(),"previousBuildDigest":digest,"proposalDigest":sha(proposal_path.read_bytes()),"previousRecoveryToolsDigest":recovery_tools_fingerprint(previous)}
            target=root/"runtime-switch-intent.json"
            target.write_text(json.dumps({"schema":1,"kind":"mint-runtime-switch-intent","switchId":"a"*32,"observationOnly":True,"binding":binding,**intent.FLAGS}))
            journal=root/"switch-journal.json"
            journal.write_text(json.dumps({"schema":1,"kind":"mint-offline-release-selection","previous":str(previous),"candidate":str(candidate),"phase":"switched","switchId":"a"*32,"intentDigest":sha(target.read_bytes()),"maintenanceDigest":sha(hold.read_bytes()),"startupAllowed":False}))
            proposal=SimpleNamespace(plain=lambda *args:None,read=lambda path:path.read_bytes(),sha=sha)
            with patch.object(selector,"STATE",root), patch.object(selector,"load_intent",return_value=intent), patch.object(intent,"load",return_value=proposal), patch.object(selector.os,"geteuid",return_value=1000), patch.object(maintenance_backup,"stopped"), patch.object(maintenance_backup,"check_database_clients"):
                review={p.name:sha(p.read_bytes()) for p in (journal,hold,target)}
                review["activeProject"]=str(candidate)
                original_journal=journal.read_bytes()
                # A valid current journal with different bytes must not be
                # accepted on behalf of a stale graphical confirmation.
                journal.write_bytes(original_journal+b" ")
                with self.assertRaisesRegex(ValueError,"Operator-reviewed"):
                    selector.rollback_offline_release("ROLL BACK OFFLINE RELEASE",review)
                self.assertEqual((root/"project").resolve(),candidate)
                self.assertEqual(journal.read_bytes(),original_journal+b" ")
                self.assertTrue(hold.exists())
                self.assertTrue(target.exists())
                self.assertFalse(startup_allowed(root))
                journal.write_bytes(original_journal)
                helper.write_text("modified")
                with self.assertRaisesRegex(ValueError,"recovery tools fingerprint"):
                    selector.rollback_offline_release("ROLL BACK OFFLINE RELEASE",review)
                self.assertEqual((root/"project").resolve(),candidate)
                self.assertEqual(journal.read_bytes(),original_journal)
                helper.write_text("original")
                result=selector.rollback_offline_release("ROLL BACK OFFLINE RELEASE",review)
                self.assertTrue(result["previousSelected"])
                self.assertTrue(selector.rollback_offline_release("ROLL BACK OFFLINE RELEASE")["previousSelected"])
            self.assertEqual((root/"project").resolve(),previous)
            self.assertTrue(candidate.exists())
            self.assertTrue(hold.exists())
            self.assertTrue(target.exists())
            self.assertFalse(startup_allowed(root))
            with patch.object(selector,"STATE",root), patch.object(selector,"load_intent",return_value=intent), patch.object(intent,"load",return_value=proposal), patch.object(selector.os,"geteuid",return_value=1000), patch.object(maintenance_backup,"stopped"), patch.object(maintenance_backup,"check_database_clients"):
                review={p.name:sha(p.read_bytes()) for p in (journal,hold,target)}
                review["activeProject"]=str(previous)
                original_journal=journal.read_bytes()
                journal.write_bytes(original_journal+b" ")
                with self.assertRaisesRegex(ValueError,"Operator-reviewed"):
                    selector.finalize_offline_rollback("FINALIZE OFFLINE ROLLBACK",review)
                self.assertEqual((root/"project").resolve(),previous)
                self.assertTrue(target.exists())
                self.assertTrue(proposal_path.exists())
                self.assertTrue(hold.exists())
                self.assertEqual(journal.read_bytes(),original_journal+b" ")
                self.assertFalse((root/("rolled-back-intent-"+"a"*32+".json")).exists())
                self.assertFalse(startup_allowed(root))
                journal.write_bytes(original_journal)
                helper.write_text("modified")
                with self.assertRaisesRegex(ValueError,"recovery tools fingerprint"):
                    selector.finalize_offline_rollback("FINALIZE OFFLINE ROLLBACK",review)
                self.assertTrue(target.exists())
                self.assertFalse(list(root.glob("rolled-back-*.json")))
                helper.write_text("original")
                original_proposal=proposal_path.read_bytes()
                proposal_path.write_bytes(original_proposal+b" ")
                with self.assertRaisesRegex(ValueError,"Activation proposal mismatch"):
                    selector.finalize_offline_rollback("FINALIZE OFFLINE ROLLBACK",review)
                self.assertTrue(journal.exists())
                self.assertTrue(target.exists())
                self.assertTrue(hold.exists())
                self.assertFalse(list(root.glob("rolled-back-*.json")))
                proposal_path.write_bytes(original_proposal)
                # Simulate a shutdown after both live proposal and intent
                # have been removed, but before the final journal unlink.
                # The actual archive operations run against disposable files.
                originals={p.name:p.read_bytes() for p in (proposal_path,target,journal)}
                original_unlink=Path.unlink
                def interrupt_at_journal(path,*args,**kwargs):
                    if path==journal:
                        raise OSError("simulated finalization interruption")
                    return original_unlink(path,*args,**kwargs)
                with patch.object(Path,"unlink",interrupt_at_journal):
                    with self.assertRaisesRegex(OSError,"simulated finalization interruption"):
                        selector.finalize_offline_rollback("FINALIZE OFFLINE ROLLBACK",review)
                self.assertFalse(proposal_path.exists())
                self.assertFalse(target.exists())
                self.assertTrue(journal.exists())
                self.assertTrue(hold.exists())
                self.assertFalse(startup_allowed(root))
                self.assertEqual((root/"project").resolve(),previous)
                archived_intent=root/("rolled-back-intent-"+"a"*32+".json")
                for kind,source in (("proposal",proposal_path),("intent",target),("journal",journal)):
                    archived=root/("rolled-back-"+kind+"-"+"a"*32+".json")
                    self.assertEqual(archived.read_bytes(),originals[source.name])
                # A fresh operator review must refer to the archived intent.
                with self.assertRaisesRegex(ValueError,"Operator-reviewed"):
                    selector.finalize_offline_rollback("FINALIZE OFFLINE ROLLBACK",review)
                fresh_review={p.name:sha(p.read_bytes()) for p in (journal,hold,archived_intent)}
                fresh_review["activeProject"]=str(previous)
                self.assertTrue(selector.finalize_offline_rollback("FINALIZE OFFLINE ROLLBACK",fresh_review)["rollbackFinalized"])
            self.assertTrue(hold.exists())
            self.assertFalse(target.exists())
            self.assertFalse(journal.exists())
            self.assertFalse(proposal_path.exists())
            self.assertTrue((root/("rolled-back-intent-"+"a"*32+".json")).is_file())
            self.assertFalse(startup_allowed(root))
    def test_offline_journal_never_authorizes_startup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            previous=root/"previous"
            candidate=root/"candidate"
            for release in (previous,candidate):
                (release/"dist").mkdir(parents=True)
                (release/"dist/server.cjs").touch()
            (root/"project").symlink_to(previous)
            for phase in ("offline-rolled-back","offline-rollback-pending","rolled-back","completed"):
                (root/"switch-journal.json").write_text(json.dumps({"kind":"mint-offline-release-selection","previous":str(previous),"candidate":str(candidate),"phase":phase}))
                self.assertFalse(startup_allowed(root))
            (root/"project").unlink()
            (root/"project").symlink_to(candidate)
            for phase in ("switched","completed"):
                (root/"switch-journal.json").write_text(json.dumps({"kind":"mint-offline-release-selection","previous":str(previous),"candidate":str(candidate),"phase":phase}))
                self.assertFalse(startup_allowed(root))
    def test_offline_release_menu_requires_confirmation_and_uses_previous_tools(self):
        from types import SimpleNamespace
        spec=importlib.util.spec_from_file_location("update_center",Path(__file__).with_name("update-center.py"))
        center=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(center)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            previous=root/"previous"
            import hashlib
            candidate=root/"staged-releases/1.2.3"
            candidate.mkdir(parents=True)
            selector=previous/"scripts/mint/select-offline-release.py"
            selector.parent.mkdir(parents=True)
            selector.touch()
            helper=selector.parent/"helper.py"
            helper.write_text("original")
            from release_fingerprint import recovery_tools_fingerprint
            (root/"project").symlink_to(candidate)
            hold=json.dumps({"purpose":"pre-update backup","previousProject":str(previous)}).encode()
            (root/"maintenance-hold.json").write_bytes(hold)
            hold_digest=hashlib.sha256(hold).hexdigest()
            intent=json.dumps({"observationOnly":True,"switchId":"fixture",
                               "binding":{"candidateVersion":"1.2.3","previousProject":str(previous),
                                          "maintenanceDigest":hold_digest,"previousRecoveryToolsDigest":recovery_tools_fingerprint(previous)}}).encode()
            (root/"runtime-switch-intent.json").write_bytes(intent)
            journal=root/"switch-journal.json"
            record={"schema":1,"kind":"mint-offline-release-selection","phase":"switched","previous":str(previous),
                    "candidate":str(candidate),"startupAllowed":False,"switchId":"fixture",
                    "intentDigest":hashlib.sha256(intent).hexdigest(),"maintenanceDigest":hold_digest}
            journal.write_text(json.dumps(record))
            yes=SimpleNamespace(returncode=0,stdout="Return to previous release")
            no=SimpleNamespace(returncode=1,stdout="")
            with patch.object(center,"STATE",root), patch.object(center,"dialog",side_effect=[yes,no]), patch.object(center,"execute") as run:
                center.offline_release_center(candidate)
                run.assert_not_called()
            with patch.object(center,"STATE",root), patch.object(center,"dialog",side_effect=[yes,yes]), patch.object(center,"execute") as run:
                center.offline_release_center(candidate)
                run.assert_called_once()
                self.assertEqual(run.call_args.args[:5],(previous,"select-offline-release.py","--rollback-offline","--confirmation","ROLL BACK OFFLINE RELEASE"))
                self.assertEqual(run.call_args.args[5],"--reviewed-evidence")
                review=json.loads(run.call_args.args[6])
                self.assertEqual(review["switch-journal.json"],hashlib.sha256(journal.read_bytes()).hexdigest())
                self.assertEqual(review["activeProject"],str(candidate))
            # Each change occurs after the menu opens, while the confirmation
            # dialog is being answered. No recovery command may be dispatched.
            for changed in (journal,root/"maintenance-hold.json",root/"runtime-switch-intent.json",selector,helper):
                with self.subTest(changed=changed.name):
                    original=changed.read_bytes()
                    def confirm_changed(*args):
                        if args[0]=="--question":
                            changed.write_bytes(original+b" ")
                        return yes
                    try:
                        with patch.object(center,"STATE",root), patch.object(center,"dialog",side_effect=confirm_changed), patch.object(center,"notice") as notice, patch.object(center,"execute") as run:
                            center.offline_release_center(candidate)
                            run.assert_not_called()
                            notice.assert_called_once()
                    finally:
                        changed.write_bytes(original)
            helper.write_text("modified before review")
            try:
                with patch.object(center,"STATE",root), patch.object(center,"dialog") as dialog, patch.object(center,"notice") as notice, patch.object(center,"execute") as run:
                    center.offline_release_center(candidate)
                    run.assert_not_called()
                    dialog.assert_not_called()
                    notice.assert_called_once()
            finally:
                helper.write_text("original")
            def confirm_pointer_change(*args):
                if args[0]=="--question":
                    (root/"project").unlink()
                    (root/"project").symlink_to(previous)
                return yes
            try:
                with patch.object(center,"STATE",root), patch.object(center,"dialog",side_effect=confirm_pointer_change), patch.object(center,"notice") as notice, patch.object(center,"execute") as run:
                    center.offline_release_center(candidate)
                    run.assert_not_called()
                    notice.assert_called_once()
            finally:
                (root/"project").unlink()
                (root/"project").symlink_to(candidate)
            journal.write_text(json.dumps({**record,"previous":str(root/"unrelated")}))
            with patch.object(center,"STATE",root), patch.object(center,"notice") as notice, patch.object(center,"execute") as run:
                center.offline_release_center(candidate)
                run.assert_not_called()
                notice.assert_called_once()
    def test_recovery_command_rejects_stale_operator_review(self):
        import hashlib
        spec=importlib.util.spec_from_file_location("selector",Path(__file__).with_name("select-offline-release.py"))
        selector=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(selector)
        path=Path("switch-journal.json")
        active=Path("/fixture/previous")
        review={path.name:hashlib.sha256(b"original").hexdigest(),"activeProject":str(active)}
        selector.verify_reviewed_evidence(review,((path,b"original"),),active)
        with self.assertRaisesRegex(ValueError,"Operator-reviewed"):
            selector.verify_reviewed_evidence(review,((path,b"changed"),),active)
        with self.assertRaisesRegex(ValueError,"Operator-reviewed"):
            selector.verify_reviewed_evidence(review,((path,b"original"),),Path("/fixture/candidate"))

    def test_recovery_evidence_reader_rejects_links_and_nonregular_entries(self):
        spec=importlib.util.spec_from_file_location("update_center",Path(__file__).with_name("update-center.py"))
        center=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(center)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve()
            evidence=root/"evidence"
            evidence.write_bytes(b"original")
            raw,identity=center.read_recovery_evidence(evidence,64)
            self.assertEqual(raw,b"original")
            replacement=root/"replacement"
            replacement.write_bytes(raw)
            replacement.replace(evidence)
            self.assertNotEqual(center.read_recovery_evidence(evidence,64)[1],identity)
            linked=root/"linked"
            linked.symlink_to(evidence)
            for invalid in (linked,root):
                with self.assertRaises(ValueError):
                    center.read_recovery_evidence(invalid,64)
            with self.assertRaises(ValueError):
                center.read_recovery_evidence(evidence,2)

    def test_offline_finalization_menu_recovers_archived_intent(self):
        from types import SimpleNamespace
        import hashlib
        spec=importlib.util.spec_from_file_location("update_center",Path(__file__).with_name("update-center.py"))
        center=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(center)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            previous=root/"previous"
            candidate=root/"staged-releases/1.2.3"
            candidate.mkdir(parents=True)
            selector=previous/"scripts/mint/select-offline-release.py"
            selector.parent.mkdir(parents=True)
            selector.write_text("# fixture")
            (root/"project").symlink_to(previous)
            switch_id="a"*32
            hold=json.dumps({"purpose":"pre-update backup","previousProject":str(previous)}).encode()
            (root/"maintenance-hold.json").write_bytes(hold)
            digest=hashlib.sha256(hold).hexdigest()
            intent=json.dumps({"observationOnly":True,"switchId":switch_id,"binding":{
                "candidateVersion":"1.2.3","previousProject":str(previous),"maintenanceDigest":digest}}).encode()
            archive=root/("rolled-back-intent-"+switch_id+".json")
            archive.write_bytes(intent)
            record={"schema":1,"kind":"mint-offline-release-selection","phase":"offline-rolled-back",
                    "previous":str(previous),"candidate":str(candidate),"startupAllowed":False,
                    "switchId":switch_id,"intentDigest":hashlib.sha256(intent).hexdigest(),"maintenanceDigest":digest}
            journal=root/"switch-journal.json"
            journal.write_text(json.dumps(record))
            yes=SimpleNamespace(returncode=0,stdout="Finalize offline rollback")
            with patch.object(center,"STATE",root), patch.object(center,"dialog",side_effect=[yes,yes]), patch.object(center,"execute") as run:
                center.offline_release_center(previous)
                run.assert_called_once()
                self.assertEqual(run.call_args.args[:5],(previous,"select-offline-release.py","--finalize-rollback","--confirmation","FINALIZE OFFLINE ROLLBACK"))
                review=json.loads(run.call_args.args[6])
                self.assertEqual(review[archive.name],hashlib.sha256(intent).hexdigest())
            for phase in ("switched","offline-rollback-pending"):
                journal.write_text(json.dumps({**record,"phase":phase}))
                with patch.object(center,"STATE",root), patch.object(center,"notice"), patch.object(center,"execute") as run:
                    center.offline_release_center(previous)
                    run.assert_not_called()
            journal.write_text(json.dumps(record))
            def reappear(*args):
                if args[0]=="--question":
                    (root/"runtime-switch-intent.json").write_bytes(intent)
                return yes
            with patch.object(center,"STATE",root), patch.object(center,"dialog",side_effect=reappear), patch.object(center,"notice"), patch.object(center,"execute") as run:
                center.offline_release_center(previous)
                run.assert_not_called()
    def test_candidate_fingerprint_survives_only_verified_runtime_links(self):
        from release_fingerprint import fingerprint
        spec=importlib.util.spec_from_file_location("intent",Path(__file__).with_name("prepare-switch-intent.py"))
        intent=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(intent)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            candidate=root/"candidate"
            runtime=root/"runtime"
            candidate.mkdir()
            runtime.mkdir()
            (candidate/"server.cjs").write_text("fixture")
            (runtime/".env.local").write_text("private")
            (runtime/"uploads").mkdir()
            (runtime/"backups").mkdir()
            digest=fingerprint(candidate)
            intent.prepare_candidate_runtime(candidate,runtime)
            self.assertEqual(fingerprint(candidate,runtime),digest)
            (runtime/".env.local").write_text("updated private")
            self.assertEqual(fingerprint(candidate,runtime),digest)
            (candidate/"uploads").unlink()
            (candidate/"uploads").symlink_to(root)
            with self.assertRaises(ValueError):
                fingerprint(candidate,runtime)
            (candidate/"uploads").unlink()
            (candidate/"uploads").symlink_to(runtime/"uploads")
            (candidate/"server.cjs").write_text("modified")
            self.assertNotEqual(fingerprint(candidate,runtime),digest)
    def test_isolated_candidate_copy_excludes_live_runtime_links(self):
        from release_fingerprint import fingerprint
        spec=importlib.util.spec_from_file_location("restore_test",Path(__file__).with_name("test-update-restore.py"))
        restore=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(restore)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            staged=root/"candidate"
            runtime=root/"runtime"
            staged.mkdir()
            runtime.mkdir()
            (staged/"server.cjs").write_text("fixture")
            (runtime/".env.local").write_text("private fixture")
            (runtime/"uploads").mkdir()
            (runtime/"backups").mkdir()
            for name in (".env.local","uploads","backups"):
                (staged/name).symlink_to(runtime/name)
            isolated=root/"isolated"
            digest=restore.copy_isolated_candidate(staged,isolated,runtime)
            self.assertEqual(fingerprint(isolated),digest)
            for name in (".env.local","uploads","backups"):
                self.assertFalse((isolated/name).exists())
                self.assertFalse((isolated/name).is_symlink())
                self.assertTrue((staged/name).is_symlink())
    def test_update_center_routes_pending_switch_directly_to_recovery(self):
        spec=importlib.util.spec_from_file_location("update_center",Path(__file__).with_name("update-center.py"))
        center=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(center)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            candidate=root/"candidate"
            candidate.mkdir()
            (root/"project").symlink_to(candidate)
            (root/"switch-journal.json").symlink_to(root/"missing")
            with patch.object(center,"STATE",root), patch.object(center.os,"geteuid",return_value=1000), patch.object(center,"offline_release_center") as recover, patch.object(center,"dialog") as dialog:
                center.main()
                recover.assert_called_once_with(candidate)
                dialog.assert_not_called()
    def test_missing_journal(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(recovery_plan(tmp)["action"],"manual-review")

if __name__=="__main__":
    unittest.main()
