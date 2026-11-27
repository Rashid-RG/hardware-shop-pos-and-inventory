import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile
spec=importlib.util.spec_from_file_location("review",Path(__file__).with_name("test-uninstall-restore-isolated.py"))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Tests(unittest.TestCase):
    def test_manifest_and_restore(self):
        tables={k:{"rows":1,"sha256":"a"*64} for k in module.REQUIRED}
        manifest=dict(version=1,archive="fixture.dump",dumpSha256="b"*64,tables=tables)
        expected=module.validate_manifest(manifest,"fixture.dump","b"*64)
        record=module.result(expected,dict(expected),"b"*64,1)
        self.assertTrue(record["allPublicTableFingerprintsMatched"])
        for flag in module.FLAGS:
            self.assertIs(record[flag],False)
        altered=dict(expected)
        altered["customers"]={"rows":1,"sha256":"c"*64}
        with self.assertRaises(ValueError):
            module.result(expected,altered,"b"*64,1)
        with self.assertRaises(ValueError):
            module.validate_manifest(manifest,"fixture.dump","c"*64)
    def test_uploads(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/"fixture.zip"
            with zipfile.ZipFile(path,"w") as archive:
                archive.writestr("uploads/document.txt","fixture")
            self.assertEqual(module.verify_uploads(path),1)
            with zipfile.ZipFile(path,"w") as archive:
                archive.writestr("uploads/../unexpected","fixture")
            with self.assertRaises(ValueError):
                module.verify_uploads(path)
if __name__=="__main__":
    unittest.main()
