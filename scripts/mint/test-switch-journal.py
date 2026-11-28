import json
from pathlib import Path
import tempfile
import unittest
from switch_journal import switch_pointer,write_journal

class SwitchTests(unittest.TestCase):
    def test_switch_and_reverse_preserve_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            old=root/"old"
            new=root/"new"
            for release in (old,new):
                (release/"dist").mkdir(parents=True)
                (release/"dist/server.cjs").write_text("test")
            pointer=root/"project"
            pointer.symlink_to(old)
            data=root/"database"
            data.write_text("existing invoices")
            write_journal(root,{"phase":"prepared","previous":str(old),"candidate":str(new)})
            switch_pointer(pointer,old,new)
            self.assertEqual(pointer.resolve(),new)
            switch_pointer(pointer,new,old)
            self.assertEqual(pointer.resolve(),old)
            self.assertEqual(data.read_text(),"existing invoices")
            self.assertEqual(json.loads((root/"switch-journal.json").read_text())["phase"],"prepared")
    def test_stale_pointer_and_missing_build_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            old=root/"old"
            new=root/"new"
            old.mkdir()
            new.mkdir()
            pointer=root/"project"
            pointer.symlink_to(old)
            with self.assertRaises(ValueError):
                switch_pointer(pointer,new,old)
            with self.assertRaises(ValueError):
                switch_pointer(pointer,old,new)
            self.assertEqual(pointer.resolve(),old)

if __name__=="__main__":
    unittest.main()
