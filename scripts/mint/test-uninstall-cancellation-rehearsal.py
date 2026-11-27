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
if __name__=="__main__":
    unittest.main()
