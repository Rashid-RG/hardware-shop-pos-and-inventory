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

    def test_switch_binding_tracks_recovery_tools(self):
        import importlib.util
        import hashlib
        import json
        from unittest.mock import patch
        spec=importlib.util.spec_from_file_location("intent",Path(__file__).with_name("prepare-switch-intent.py"))
        intent=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(intent)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            project=root/"previous"
            (project/"scripts").mkdir(parents=True)
            helper=project/"scripts/helper.py"
            helper.write_text("original")
            folder=root/"backup"
            folder.mkdir()
            (root/"runtime-activation-proposal.json").write_text("{}")
            restore=folder/"restore-test.json"
            restore.write_text(json.dumps({"buildFingerprint":"a"*64,"previousBuildFingerprint":"b"*64}))
            class Proposal:
                @staticmethod
                def read(path): return path.read_bytes()
                @staticmethod
                def sha(raw): return hashlib.sha256(raw).hexdigest()
                @staticmethod
                def matches(record,observed): return True
                @staticmethod
                def snapshot(folder): return {"candidateVersion":"1.2.3","previousProject":str(project),"evidence":{"restore":Proposal.sha(restore.read_bytes()),"hold":"c"*64}}
            with patch.object(intent,"STATE",root):
                binding=intent.verified_binding(folder,Proposal)
                record={"schema":1,"kind":"mint-runtime-switch-intent","switchId":"a"*32,"observationOnly":True,"binding":binding,**intent.FLAGS}
                self.assertTrue(intent.matches(record,intent.verified_binding(folder,Proposal)))
                helper.write_text("modified")
                self.assertFalse(intent.matches(record,intent.verified_binding(folder,Proposal)))
                helper.write_text("original")
                self.assertTrue(intent.matches(record,intent.verified_binding(folder,Proposal)))

if __name__=="__main__":
    unittest.main()
