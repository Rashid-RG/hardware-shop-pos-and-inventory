import importlib.util
import json
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location("plan",Path(__file__).with_name("repair-activation-plan.py"))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Tests(unittest.TestCase):
    def fixture(self):
        return dict(schema=1,kind="mint-repair-rollback-preparation",repairSpecificRollbackTested=True,
                    continuousExclusionVerified=False,previousProject="/test/previous",
                    previousBuildFingerprint="a"*64,repairBuildFingerprint="b"*64,archiveSha256="c"*64,
                    repairEvidenceDigests={"test":"d"*64},**module.FLAGS)
    def test_non_authorizing(self):
        record=self.fixture()
        plan=module.make_plan(json.dumps(record).encode(),record,Path("repair-preparation-test"))
        for flag in (*module.FLAGS,"fileSwitchAllowed","nativeHostRepairCertified","continuousExclusionVerified"):
            self.assertIs(plan[flag],False)
    def test_stale_evidence(self):
        record=self.fixture()
        raw=json.dumps(record).encode()
        record["archiveSha256"]="e"*64
        with self.assertRaises(ValueError):
            module.validate(raw,record)
    def test_authorization_rejected(self):
        record=self.fixture()
        record["activationAllowed"]=True
        with self.assertRaises(ValueError):
            module.validate(json.dumps(record).encode(),record)
if __name__=="__main__":
    unittest.main()
