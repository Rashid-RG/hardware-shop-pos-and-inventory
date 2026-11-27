import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location("backup",Path(__file__).with_name("prepare-uninstall-backup.py"))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
class Tests(unittest.TestCase):
    def test_hold(self):
        project=Path("/fixture/project")
        hold=dict(purpose="pre-uninstall backup",previousProject=str(project),version="1.0.0",uninstallId="a"*32,applicationRemovalAllowed=False)
        module.validate_hold(hold,project,"1.0.0")
        for key,value in (("purpose","pre-update backup"),("applicationRemovalAllowed",True),("uninstallId","../unsafe")):
            with self.assertRaises(ValueError):
                module.validate_hold(dict(hold,**{key:value}),project,"1.0.0")
    def test_complete_archive(self):
        dump=Path("ars-mint-20261127T120000Z-"+"a"*32+"-v2-with-uploads.dump")
        self.assertEqual(len(module.members(dump)),6)
        with self.assertRaises(ValueError):
            module.members(Path(str(dump).replace("with-uploads","database-only")))
if __name__=="__main__":
    unittest.main()
