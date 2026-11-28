"""Offline unit tests for update build integrity."""
import tempfile
import unittest
from pathlib import Path

from release_fingerprint import fingerprint, recovery_tools_fingerprint

class FingerprintTests(unittest.TestCase):
    def test_deterministic_and_content_sensitive(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/"dist").mkdir()
            (root/"dist/server.cjs").write_text("original")
            (root/"node_modules").mkdir()
            dependency=root/"node_modules/dependency.js"
            dependency.write_text("dependency")
            before=fingerprint(root)
            self.assertEqual(before,fingerprint(root))
            dependency.write_text("modified dependency")
            self.assertNotEqual(before,fingerprint(root))
            dependency.write_text("dependency")
            self.assertEqual(before,fingerprint(root))
            (root/"dist/server.cjs").write_text("modified")
            self.assertNotEqual(before,fingerprint(root))

    def test_external_link_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/"release"
            root.mkdir()
            external=Path(tmp)/"external"
            external.write_text("outside")
            (root/"link").symlink_to(external)
            with self.assertRaises(ValueError):
                fingerprint(root)

    def test_internal_link_and_mode_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            target=root/"script"
            target.write_text("test")
            (root/"link").symlink_to("script")
            before=fingerprint(root)
            target.chmod(0o700 if target.stat().st_mode & 0o777 != 0o700 else 0o600)
            self.assertNotEqual(before,fingerprint(root))

    def test_recovery_tools_fingerprint(self):
        with tempfile.TemporaryDirectory() as tmp:
            project=Path(tmp)
            scripts=project/"scripts"
            scripts.mkdir()
            helper=scripts/"helper.py"
            helper.write_text("original")
            before=recovery_tools_fingerprint(project)
            cache=scripts/"__pycache__"
            cache.mkdir()
            (cache/"helper.cpython-312.pyc").write_bytes(b"generated")
            self.assertEqual(before,recovery_tools_fingerprint(project))
            helper.write_text("changed")
            self.assertNotEqual(before,recovery_tools_fingerprint(project))
            helper.write_text("original")
            self.assertEqual(before,recovery_tools_fingerprint(project))
            helper.chmod(helper.stat().st_mode ^ 0o100)
            self.assertNotEqual(before,recovery_tools_fingerprint(project))

    def test_recovery_tools_reject_links_and_bytecode(self):
        with tempfile.TemporaryDirectory() as tmp:
            project=Path(tmp)
            scripts=project/"scripts"
            scripts.mkdir()
            outside=project/"outside"
            outside.write_text("external")
            link=scripts/"helper.py"
            link.symlink_to(outside)
            with self.assertRaises(ValueError):
                recovery_tools_fingerprint(project)
            link.unlink()
            (scripts/"helper.pyc").write_bytes(b"unexpected")
            with self.assertRaises(ValueError):
                recovery_tools_fingerprint(project)

if __name__=="__main__":
    unittest.main()
