"""Exercise retention on synthetic files, never a real installation."""
import tempfile
from pathlib import Path
import unittest
from release_fingerprint import fingerprint
from repair_test_build import retain_tested_build, verify_retained_build

class Tests(unittest.TestCase):
    def test_retain_and_reject_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve()
            repair=root/"repair"
            source=root/"build"
            repair.mkdir()
            (source/"dist").mkdir(parents=True)
            (source/"node_modules").mkdir()
            (source/"dist/server.cjs").write_text("server")
            (source/"dist/index.html").write_text("html")
            (source/"package-lock.json").write_text("{}")
            (source/"node_modules/module").write_text("dependency")
            expected=fingerprint(source)
            retained=retain_tested_build(repair,source,expected)
            self.assertEqual(fingerprint(retained),expected)
            self.assertEqual(verify_retained_build(repair,expected),retained)
            with self.assertRaises(ValueError):
                retain_tested_build(repair,source,expected)
            (retained/"dist/server.cjs").write_text("altered")
            with self.assertRaises(ValueError):
                verify_retained_build(repair,expected)
    def test_external_link_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve()
            repair=root/"repair"
            repair.mkdir()
            (repair/"tested-build").symlink_to(root,target_is_directory=True)
            with self.assertRaises(ValueError):
                verify_retained_build(repair,"a"*64)

if __name__=="__main__":
    unittest.main()
