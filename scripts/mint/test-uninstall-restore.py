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
    def test_final_review(self):
        from uninstall_final_review import review, FLAGS
        from copy import deepcopy
        uid="a"*32
        archive="ars-mint-20261127T120000Z-"+uid+"-v2-with-uploads.dump"
        evidence={k:"b"*64 for k in ("hold","shutdown","meta","receipt")}
        members={p.name:"c"*64 for p in module.load_prepare().members(Path(archive))}
        record=dict(schema=1,kind="mint-uninstall-restore-observation",uninstallId=uid,
                    archiveSha256=members[archive],isolatedRestorePassed=True,
                    allPublicTableFingerprintsMatched=True,uploadArchiveIntegrityVerified=True,
                    restoredTableCount=5,uploadMemberCount=0,evidenceDigests=evidence,
                    archiveMemberDigests=members,**{k:False for k in FLAGS})
        plan=review(record,uid,archive,evidence,members)
        self.assertTrue(plan["restoreObservationMatched"])
        for flag in FLAGS:
            self.assertIs(plan[flag],False)
            bad=deepcopy(record)
            bad[flag]=True
            with self.assertRaises(ValueError):
                review(bad,uid,archive,evidence,members)
        for key in ("uninstallId","archiveSha256","isolatedRestorePassed","evidenceDigests","archiveMemberDigests"):
            bad=deepcopy(record)
            del bad[key]
            with self.assertRaises(ValueError):
                review(bad,uid,archive,evidence,members)
        altered=dict(members)
        altered[archive]="d"*64
        with self.assertRaises(ValueError):
            review(record,uid,archive,evidence,altered)
        altered=dict(evidence,shutdown="e"*64)
        with self.assertRaises(ValueError):
            review(record,uid,archive,altered,members)
if __name__=="__main__":
    unittest.main()
