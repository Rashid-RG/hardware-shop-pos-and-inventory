import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location("review",Path(__file__).with_name("repair-backup-review.py"))
review=importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)
class Tests(unittest.TestCase):
    def test_external_repair_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(review,"STATE",Path(folder)):
                with self.assertRaises(ValueError):
                    review.validate_repair(Path(folder)/"other",Path(folder),None)
    def test_missing_receipt_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve()
            repair=root/"repair-preparation-test"
            repair.mkdir()
            observer=review.load_observer()
            with patch.object(review,"STATE",root):
                with self.assertRaises(OSError):
                    review.validate_repair(repair,root,observer)
if __name__=="__main__":
    unittest.main()
