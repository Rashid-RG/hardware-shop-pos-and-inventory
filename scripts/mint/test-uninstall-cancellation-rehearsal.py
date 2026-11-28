"""Exercise real cancellation file transitions only in temporary fixture storage."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uninstall_cancellation as c
from startup_guard import startup_allowed

class Rehearsal(unittest.TestCase):
    def test_cut_points(self):
        for phase in ("archive","receipt","proof_removed","complete"):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as tmp:
                state=Path(tmp).resolve()
                project=state/"fixture-app";project.mkdir()
                (state/"project").symlink_to(project)
                business=state/"runtime";business.mkdir()
                sample=business/"sample-invoices.json";sample.write_bytes(b'{"fixture":true}')
                recovery=state/"uninstall-recovery"/("a"*32)
                recovery.mkdir(parents=True)
                archive=recovery/"fixture.dump";archive.write_bytes(b"synthetic archive, not a PostgreSQL dump")
                hold=state/"maintenance-hold.json";proof=state/"uninstall-shutdown.json"
                raw=json.dumps(dict(schema=1,purpose="pre-uninstall backup",previousProject=str(project),uninstallId="a"*32,applicationRemovalAllowed=False,databaseDeletionAllowed=False)).encode()
                evidence=json.dumps(dict(schema=1,kind="mint-uninstall-shutdown-observation",uninstallId="a"*32,previousProject=str(project),holdDigest=hashlib.sha256(raw).hexdigest(),serviceStopped=True,ordinaryStartupBlocked=True,databaseClientsAbsentAtCheck=True,applicationRemovalAllowed=False,databaseDeletionAllowed=False,continuousExclusionVerified=False,finalUninstallBackupVerified=False)).encode()
                hold.write_bytes(raw);proof.write_bytes(evidence)
                self.assertFalse(startup_allowed(state))
                before={p:p.read_bytes() for p in (sample,archive)}
                def check():
                    if hold.read_bytes()!=raw or proof.read_bytes()!=evidence:
                        raise ValueError("Evidence changed")
                original_sync=c.sync_dir
                original_archive=c.archive_bytes
                original_retain=c.retain
                def archive_cut(path,data):
                    original_archive(path,data)
                    if phase=="archive": raise RuntimeError("simulated interruption")
                def receipt_cut(path,data):
                    original_retain(path,data)
                    if phase=="receipt": raise RuntimeError("simulated interruption")
                def sync_cut(path):
                    original_sync(path)
                    if phase=="proof_removed" and not proof.exists() and hold.exists(): raise RuntimeError("simulated interruption")
                with patch.object(c,"archive_bytes",archive_cut),patch.object(c,"retain",receipt_cut),patch.object(c,"sync_dir",sync_cut):
                    args=(state,project,hold,proof,raw,evidence,"a"*32,check)
                    if phase=="complete":
                        result=c.complete_cancellation(*args)
                        self.assertFalse(result["applicationStarted"])
                        self.assertFalse(result["applicationRemovalAllowed"])
                        self.assertTrue(startup_allowed(state))
                    else:
                        with self.assertRaises(RuntimeError): c.complete_cancellation(*args)
                        self.assertFalse(startup_allowed(state))
                        self.assertEqual(hold.read_bytes(),raw)
                history=state/("uninstall-cancelled-"+"a"*32)
                self.assertEqual((history/hold.name).read_bytes(),raw)
                if phase in ("receipt","proof_removed","complete"):
                    self.assertEqual((history/proof.name).read_bytes(),evidence)
                    self.assertTrue((history/"cancellation.json").is_file())
                for p,content in before.items(): self.assertEqual(p.read_bytes(),content)
                self.assertEqual((state/"project").resolve(),project)

    def test_coordinator_failure_paths(self):
        import uninstall_coordinator as coordinator
        import fcntl
        from unittest.mock import Mock
        from contextlib import ExitStack
        for phase in ("backup", "restore", "review", "complete"):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as tmp:
                state=Path(tmp).resolve()
                project=state/"project";project.mkdir()
                uid="a"*32
                hold=state/"maintenance-hold.json"
                proof=state/"uninstall-shutdown.json"
                record={"uninstallId":uid,"version":"1.0.0"}
                observation={"uninstallId":uid}
                hold.write_text(json.dumps(record))
                proof.write_text(json.dumps(observation))
                sample=state/"business.json";sample.write_bytes(b"synthetic business data")
                before={p:p.read_bytes() for p in (hold,proof,sample)}
                restore=Mock()
                def assert_retained(folder=None, lock=None, **kwargs):
                    with (state/"maintenance.lock").open("a") as competitor:
                        with self.assertRaises(BlockingIOError):
                            fcntl.flock(competitor,fcntl.LOCK_EX|fcntl.LOCK_NB)
                def restore_stage(folder, lock):
                    assert_retained(folder, lock)
                    return {"uninstallId":uid,"isolatedRestorePassed":True}
                restore._inspect.side_effect=restore_stage
                backup=Mock()
                final=Mock(return_value={"uninstallId":uid,"restoreObservationMatched":True,
                                         **{k:False for k in coordinator.FLAGS}})
                backup.side_effect=lambda *args, **kwargs: assert_retained()
                def final_stage(folder, lock):
                    assert_retained(folder, lock)
                    return final.return_value
                final.side_effect=final_stage
                if phase=="backup": backup.side_effect=RuntimeError("simulated backup failure")
                if phase=="restore": restore._inspect.side_effect=RuntimeError("simulated restore failure")
                if phase=="review": final.side_effect=RuntimeError("simulated review failure")
                spec=Mock()
                with ExitStack() as stack:
                    for name,value in (("STATE",state),("shutdown",Mock(return_value=observation)),
                                       ("read_regular",lambda p:p.read_bytes()),("validate",Mock()),
                                       ("stopped",Mock()),("inspect_final",final)):
                        stack.enter_context(patch.object(coordinator,name,value))
                    stack.enter_context(patch.object(coordinator.os,"geteuid",return_value=1000))
                    stack.enter_context(patch.object(coordinator.subprocess,"run",backup))
                    stack.enter_context(patch.object(coordinator.importlib.util,"spec_from_file_location",return_value=spec))
                    stack.enter_context(patch.object(coordinator.importlib.util,"module_from_spec",return_value=restore))
                    if phase=="complete":
                        result=coordinator.rehearse(coordinator.CONFIRMATION)
                        self.assertTrue(result["finalReviewMatched"])
                        for flag in coordinator.FLAGS: self.assertIs(result[flag],False)
                    else:
                        with self.assertRaisesRegex(RuntimeError,"simulated"):
                            coordinator.rehearse(coordinator.CONFIRMATION)
                backup.assert_called_once()
                self.assertEqual(restore._inspect.call_count,0 if phase=="backup" else 1)
                self.assertEqual(final.call_count,1 if phase in ("review","complete") else 0)
                for p,raw in before.items(): self.assertEqual(p.read_bytes(),raw)
                self.assertFalse(startup_allowed(state))
if __name__=="__main__":
    unittest.main()
