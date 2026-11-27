import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from repair_interruption import FLAGS,MARKER,make_record,retain_marker,inspect
from startup_guard import startup_allowed

class Tests(unittest.TestCase):
    def test_interruption_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory)
            repair=state/"repair-preparation-test"
            repair.mkdir()
            raw=json.dumps(dict(schema=1,kind="mint-repair-rollback-preparation",repairSpecificRollbackTested=True,**FLAGS)).encode()
            (repair/"rollback-preparation.json").write_bytes(raw)
            record=make_record(repair.name,hashlib.sha256(raw).hexdigest())
            self.assertTrue(startup_allowed(state))
            retain_marker(state,record)
            self.assertFalse(startup_allowed(state))
            self.assertTrue(inspect(state)["markerRetained"])
            with self.assertRaises(FileExistsError):
                retain_marker(state,record)
            (repair/"rollback-preparation.json").write_bytes(raw+b" ")
            with self.assertRaises(ValueError):
                inspect(state)
            self.assertFalse(startup_allowed(state))
            self.assertTrue((state/MARKER).is_file())
    def test_malformed_marker_blocks(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory)
            (state/MARKER).write_text("{")
            self.assertFalse(startup_allowed(state))
            with self.assertRaises(ValueError):
                inspect(state)
if __name__=="__main__":
    unittest.main()
