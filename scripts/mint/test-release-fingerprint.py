"""Offline unit tests for update build integrity."""
import tempfile
import unittest
from pathlib import Path

from release_fingerprint import fingerprint

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

if __name__=="__main__":
    unittest.main()
