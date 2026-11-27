import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from installation_identity import record,review

class Tests(unittest.TestCase):
    def test_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve()
            state=root/"state";project=root/"app"
            runtime=state/"runtime";runtime.mkdir(parents=True)
            project.mkdir()
            (state/"project").symlink_to(project)
            for name in ("uploads","backups"):
                (runtime/name).mkdir()
            (runtime/".env.local").write_text("fixture")
            for name in (".env.local","uploads","backups"):
                (project/name).symlink_to(runtime/name)
            manifest={}
            for name in ("package.json","package-lock.json","PILOT-RELEASE.json","scripts/mint/install.sh","dist/server.cjs","dist/index.html"):
                p=project/name
                p.parent.mkdir(parents=True,exist_ok=True)
                p.write_text("fixture")
                if not name.startswith("dist/"):
                    manifest[name]={"sha256":hashlib.sha256(b"fixture").hexdigest()}
            (project/"PILOT-FILES.json").write_text(json.dumps(manifest))
            record(state,project)
            result=review(state,project)
            self.assertTrue(result["installationIdentityMatched"])
            self.assertIs(result["applicationRemovalAllowed"],False)
            with self.assertRaises(ValueError):
                record(state,project)
            (project/"unrelated.txt").write_text("retain")
            with self.assertRaises(ValueError):
                review(state,project)
            self.assertEqual((project/"unrelated.txt").read_text(),"retain")
if __name__=="__main__":
    unittest.main()
