import importlib.util
from pathlib import Path
import tempfile
import unittest
spec=importlib.util.spec_from_file_location("uninstall",Path(__file__).with_name("uninstall-preview.py"))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Tests(unittest.TestCase):
    def test_plan_and_rejection(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve()
            state=root/"state"
            project=root/"application"
            runtime=state/"runtime"
            runtime.mkdir(parents=True)
            (project/"dist").mkdir(parents=True)
            for name in ("server.cjs","index.html"):
                (project/"dist"/name).write_text("fixture")
            (state/"project").symlink_to(project)
            (runtime/".env.local").write_text("fixture")
            for name in ("uploads","backups"):
                (runtime/name).mkdir()
                (runtime/name/"fixture.txt").write_text(name)
            for name in (".env.local","uploads","backups"):
                (project/name).symlink_to(runtime/name)
            plan=module.inspect(state,project)
            for flag in ("databaseDeletionAllowed","applicationRemovalAllowed","serviceRemovalAllowed","backupVerified","installationOwnershipCertified","uninstalled"):
                self.assertIs(plan[flag],False)
            self.assertEqual((runtime/"uploads/fixture.txt").read_text(),"uploads")
            (state/"repair-interrupted.json").write_text("{")
            with self.assertRaises(ValueError):
                module.inspect(state,project)
            (state/"repair-interrupted.json").unlink()
            (project/"backups").unlink()
            (project/"backups").mkdir()
            with self.assertRaises(ValueError):
                module.inspect(state,project)
            self.assertEqual((runtime/"backups/fixture.txt").read_text(),"backups")

if __name__=="__main__":
    unittest.main()
