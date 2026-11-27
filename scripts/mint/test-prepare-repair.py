import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
spec=importlib.util.spec_from_file_location("repair",Path(__file__).with_name("prepare-repair.py"))
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
class Tests(unittest.TestCase):
    def test_isolated_preparation(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve()
            state=root/"state"
            project=root/"active"
            source=root/"download"
            for p in (state,project,source):
                p.mkdir()
            (state/"project").symlink_to(project)
            manifest={}
            for name in ("package.json","package-lock.json","scripts/mint/install.sh","PILOT-RELEASE.json"):
                p=source/name
                p.parent.mkdir(parents=True,exist_ok=True)
                p.write_text(name)
                manifest[name]={"sha256":hashlib.sha256(name.encode()).hexdigest(),"mode":420}
            for p in (source,project):
                (p/"PILOT-FILES.json").write_text(json.dumps(manifest))
            (project/"PILOT-RELEASE.json").write_text("PILOT-RELEASE.json")
            (project/"package.json").write_text("damaged")
            result=mod.prepare(state,project,source)
            receipt=json.loads((result/"repair-preparation.json").read_text())
            self.assertFalse(receipt["activationAllowed"])
            self.assertFalse(receipt["backupVerified"])
            self.assertEqual((project/"package.json").read_text(),"damaged")
            self.assertEqual((result/"candidate/package.json").read_text(),"package.json")
            (source/"PILOT-RELEASE.json").write_text("different")
            with self.assertRaises(RuntimeError):
                mod.prepare(state,project,source)
            (state/"switch-journal.json").symlink_to(state/"missing")
            with self.assertRaises(RuntimeError):
                mod.prepare(state,project,source)
if __name__=="__main__":
    unittest.main()
