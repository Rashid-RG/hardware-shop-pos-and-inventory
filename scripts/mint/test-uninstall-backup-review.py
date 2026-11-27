import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location("review",Path(__file__).with_name("uninstall-backup-review.py"))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Tests(unittest.TestCase):
    def fixture(self):
        project=Path("/fixture/project")
        recovery=Path("/fixture/state/update-recovery/test")
        evidence=dict(schema=1,previousProject=str(project),recoveryFolder=str(recovery),
                      backupHoldBindingVerified=True,activationAllowed=False,startupAllowed=False,
                      runtimeActivated=False,rollbackAllowed=False,continuousExclusionVerified=False,
                      evidence={k:"a"*64 for k in ("hold","binding","configuration","recovery","restore","protectedBackup")})
        return evidence,project,recovery
    def test_review_does_not_authorize(self):
        plan=module.result(*self.fixture())
        self.assertTrue(plan["protectedUpdateBackupMatched"])
        for flag in module.FLAGS:
            self.assertIs(plan[flag],False)
    def test_missing_digest(self):
        evidence,project,recovery=self.fixture()
        del evidence["evidence"]["restore"]
        with self.assertRaises(ValueError):
            module.result(evidence,project,recovery)
    def test_other_installation(self):
        evidence,project,recovery=self.fixture()
        with self.assertRaises(ValueError):
            module.result(evidence,Path("/other"),recovery)
    def test_authorization(self):
        evidence,project,recovery=self.fixture()
        evidence["startupAllowed"]=True
        with self.assertRaises(ValueError):
            module.result(evidence,project,recovery)
if __name__=="__main__":
    unittest.main()
