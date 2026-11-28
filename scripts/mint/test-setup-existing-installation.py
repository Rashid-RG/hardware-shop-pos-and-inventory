"""Check that fresh setup routes only a managed installation to maintenance."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("setup_wizard", Path(__file__).with_name("setup-wizard.py"))
wizard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wizard)


class ExistingInstallationTests(unittest.TestCase):
    def test_only_managed_maintenance_entry_point_is_returned(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            state = root / "state"
            state.mkdir()
            project = root / "application"
            entry = project / "scripts/mint/maintenance-center.py"
            entry.parent.mkdir(parents=True)
            entry.write_text("# fixture\n")
            with patch.object(wizard.os, "geteuid", return_value=1000):
                with self.assertRaisesRegex(RuntimeError, "incomplete"):
                    wizard.installed_maintenance(state)
                (state / "project").symlink_to(project)
                self.assertEqual(wizard.installed_maintenance(state), (entry, project))
                entry.unlink()
                other = root / "other.py"
                other.write_text("# fixture\n")
                entry.symlink_to(other)
                with self.assertRaisesRegex(RuntimeError, "Maintenance Center"):
                    wizard.installed_maintenance(state)


if __name__ == "__main__":
    unittest.main()
