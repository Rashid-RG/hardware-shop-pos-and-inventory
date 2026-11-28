import importlib.util
from pathlib import Path
import tempfile
import unittest
spec=importlib.util.spec_from_file_location("rollback",Path(__file__).with_name("repair-rollback-preparation.py"))
rollback=importlib.util.module_from_spec(spec)
spec.loader.exec_module(rollback)

class Tests(unittest.TestCase):
    def test_previous_build_binding(self):
        record={k:True for k in ("restoreTestPassed","migrationCompatibilityPassed","backwardStartupPassed","authenticatedReadsPassed","authenticatedWritesPassed")}
        record.update(previousBuildFingerprint="a"*64,activationApproved=False)
        self.assertEqual(rollback.validate_previous(record,"a"*64),"a"*64)
        with self.assertRaises(ValueError):
            rollback.validate_previous(record,"b"*64)
        record["backwardStartupPassed"]=False
        with self.assertRaises(ValueError):
            rollback.validate_previous(record,"a"*64)
    def test_executable_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/"dist").mkdir()
            (root/"node_modules").mkdir()
            (root/"dist/server.cjs").write_text("fixture")
            (root/"node_modules/dependency").write_text("fixture")
            (root/".env.local").write_text("synthetic private configuration")
            expected=rollback.executable_fingerprint(root)
            (root/".env.local").write_text("changed")
            self.assertEqual(rollback.executable_fingerprint(root),expected)
            (root/"dist/server.cjs").write_text("modified")
            self.assertNotEqual(rollback.executable_fingerprint(root),expected)
if __name__=="__main__":
    unittest.main()
