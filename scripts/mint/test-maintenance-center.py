import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location("maintenance",Path(__file__).with_name("maintenance-center.py"))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
class Tests(unittest.TestCase):
    def test_hold_blocks_readiness_probe(self):
        with tempfile.TemporaryDirectory() as folder:
            state=Path(folder)
            (state/"maintenance-hold.json").symlink_to(state/"missing")
            with patch.object(module,"service_status",return_value="active"),patch.object(module,"readiness") as ready:
                report=module.snapshot(state,state)
                self.assertEqual(report["Maintenance evidence"],"Review required")
                self.assertEqual(report["Database readiness"],"Not confirmed")
                ready.assert_not_called()
    def test_active_readiness(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(module,"service_status",return_value="active"),patch.object(module,"readiness",return_value=True):
                self.assertEqual(module.snapshot(Path(folder),Path(folder))["Database readiness"],"Endpoint reports ready")
if __name__=="__main__":
    unittest.main()
