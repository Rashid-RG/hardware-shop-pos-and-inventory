"""Launcher behavior tests; no actual service, browser or database is started."""
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
import fcntl

spec=importlib.util.spec_from_file_location('ars_launcher',Path(__file__).with_name('open.py'))
launcher=importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

class LauncherTests(unittest.TestCase):
    def test_duplicate_click(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ,{'XDG_RUNTIME_DIR':root}):
            with (Path(root)/'ars-hardware-launch.lock').open('a') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with patch.object(launcher.subprocess,'Popen') as popup:
                    self.assertEqual(launcher.main(),0)
                    popup.assert_not_called()
    def test_success_and_failure_release_lock(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ,{'XDG_RUNTIME_DIR':root}):
            with patch.object(launcher.subprocess,'Popen') as popup, patch.object(launcher.subprocess,'run') as command, patch.object(launcher,'launch') as launch:
                popup.return_value.poll.return_value=None
                launch.side_effect=RuntimeError('Recovery required')
                self.assertEqual(launcher.main(),1)
                command.assert_called_once()
                launch.side_effect=None
                self.assertEqual(launcher.main(),0)
                self.assertEqual(launch.call_count,2)

if __name__=='__main__':
    unittest.main()
