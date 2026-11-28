import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from uninstall_cancellation import validate,archive_bytes,CONFIRMATION

class Tests(unittest.TestCase):
    def test_cancellation_evidence(self):
        project=Path("/fixture/app")
        hold=dict(schema=1,purpose="pre-uninstall backup",previousProject=str(project),uninstallId="a"*32,applicationRemovalAllowed=False,databaseDeletionAllowed=False)
        raw=json.dumps(hold).encode()
        proof=dict(schema=1,kind="mint-uninstall-shutdown-observation",uninstallId=hold["uninstallId"],previousProject=str(project),holdDigest=hashlib.sha256(raw).hexdigest(),serviceStopped=True,ordinaryStartupBlocked=True,databaseClientsAbsentAtCheck=True,applicationRemovalAllowed=False,databaseDeletionAllowed=False,continuousExclusionVerified=False,finalUninstallBackupVerified=False)
        evidence=json.dumps(proof).encode()
        self.assertEqual(validate(raw,evidence,project,CONFIRMATION),"a"*32)
        for flag in ("serviceStopped","ordinaryStartupBlocked","applicationRemovalAllowed","continuousExclusionVerified"):
            with self.assertRaises(ValueError):
                validate(raw,json.dumps(dict(proof,**{flag:not proof[flag]})).encode(),project,CONFIRMATION)
        with self.assertRaises(ValueError):
            validate(raw+b" ",evidence,project,CONFIRMATION)
        with self.assertRaises(ValueError):
            validate(raw,evidence,project,"CANCEL")
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"hold.json"
            archive_bytes(path,raw)
            self.assertEqual(path.read_bytes(),raw)
            with self.assertRaises(FileExistsError):
                archive_bytes(path,b"changed")
            self.assertEqual(path.read_bytes(),raw)

if __name__=="__main__":
    unittest.main()
