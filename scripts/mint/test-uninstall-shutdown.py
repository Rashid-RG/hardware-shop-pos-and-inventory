import json
from pathlib import Path
import tempfile
import unittest
from uninstall_shutdown import make_hold,retain,validate_service,CONFIRMATION
class Tests(unittest.TestCase):
    def test_hold(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve()
            hold=make_hold(root,"1.0.0",CONFIRMATION)
            self.assertEqual(hold["purpose"],"pre-uninstall backup")
            self.assertFalse(hold["applicationRemovalAllowed"])
            self.assertFalse(hold["databaseDeletionAllowed"])
            path=root/"maintenance-hold.json"
            retain(path,hold)
            self.assertEqual(json.loads(path.read_text()),hold)
            with self.assertRaises(FileExistsError):
                retain(path,hold)
            with self.assertRaises(ValueError):
                make_hold(root,"1.0.0","STOP")
    def test_service(self):
        unit=Path("/fixture/ars-hardware.service")
        values=dict(LoadState="loaded",FragmentPath=str(unit),DropInPaths="",NeedDaemonReload="no")
        validate_service(values,unit)
        for key,value in (("FragmentPath","/unrelated.service"),("DropInPaths","override.conf"),("NeedDaemonReload","yes")):
            with self.assertRaises(ValueError):
                validate_service(dict(values,**{key:value}),unit)
if __name__=="__main__":
    unittest.main()
