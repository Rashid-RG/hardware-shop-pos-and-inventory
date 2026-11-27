import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from setup_destination import copy_release

class DestinationTests(unittest.TestCase):
    def test_copy_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve()
            src=root/"download"
            src.mkdir()
            manifest={}
            for name in ("package.json","package-lock.json","scripts/mint/install.sh","PILOT-RELEASE.json"):
                p=src/name
                p.parent.mkdir(parents=True,exist_ok=True)
                p.write_text(name)
                manifest[name]={"sha256":hashlib.sha256(name.encode()).hexdigest(),"mode":0o644}
            (src/"PILOT-FILES.json").write_text(json.dumps(manifest))
            dest=root/"installed"
            copy_release(src,dest)
            self.assertEqual((dest/"package.json").read_text(),"package.json")
            with self.assertRaises(RuntimeError):
                copy_release(src,dest)
            (src/"package.json").write_text("tampered")
            with self.assertRaises(RuntimeError):
                copy_release(src,root/"other")
            self.assertFalse((root/"other").exists())

if __name__=="__main__":
    unittest.main()
