import json
import subprocess
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from switch_coordinator import simulate_switch
from startup_guard import startup_allowed

class Service:
    def __init__(self,root,fail=False):
        self.root=root
        self.running=True
        self.fail=fail
    def stop(self): self.running=False
    def stopped(self): return not self.running
    def start(self): self.running=True
    def ready(self):
        return self.running and not (self.fail and (self.root/"project").resolve()==self.root/"new")

class ProcessService:
    def __init__(self, root):
        self.root = root
        self.process = None

    def start(self):
        server = self.root / "project/dist/server.cjs"
        self.process = subprocess.Popen(["node", str(server)], stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL)

    def stop(self):
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            self.process.wait(timeout=5)

    def stopped(self):
        return self.process is None or self.process.poll() is not None

    def ready(self):
        import time
        marker = self.root / "server-ready"
        for _ in range(100):
            if self.stopped():
                return False
            if marker.exists() and marker.read_text() == str(self.process.pid):
                return True
            time.sleep(0.02)
        return False


class CoordinatorTests(unittest.TestCase):
    def exercise(self,fail,backup,expected,release):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve()
            (root/".ars-switch-test").touch()
            for name in ("old","new"):
                dist=root/name/"dist"
                dist.mkdir(parents=True)
                (dist/"server.cjs").touch()
            (root/"project").symlink_to(root/"old")
            (root/"business-data").write_text("historical invoices")
            service=Service(root,fail)
            self.assertEqual(simulate_switch(root,service,lambda:backup),expected)
            self.assertEqual((root/"project").resolve(),root/release)
            self.assertEqual((root/"business-data").read_text(),"historical invoices")
            self.assertTrue(service.ready())
            self.assertFalse(startup_allowed(root))
    def test_success(self): self.exercise(False,True,"updated","new")
    def test_unhealthy_candidate(self): self.exercise(True,True,"rolled-back","old")
    def test_backup_rejection(self): self.exercise(False,False,"rolled-back","old")

    def test_failed_candidate_process_restarts_previous_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            (root / ".ars-switch-test").touch()
            data = root / "business-data"
            data.write_text("historical invoices")
            for release, source in (
                ("old", "require('node:fs').writeFileSync(" + json.dumps(str(root / "server-ready")) +
                 ", String(process.pid)); setInterval(() => {}, 1000);"),
                ("new", "process.exit(12);"),
            ):
                server = root / release / "dist/server.cjs"
                server.parent.mkdir(parents=True)
                server.write_text(source)
            (root / "project").symlink_to(root / "old")
            service = ProcessService(root)
            try:
                service.start()
                self.assertTrue(service.ready())
                self.assertEqual(simulate_switch(root, service, lambda: True), "rolled-back")
                self.assertTrue(service.ready())
                self.assertEqual((root / "project").resolve(), root / "old")
                self.assertEqual(data.read_text(), "historical invoices")
                self.assertEqual(json.loads((root / "switch-journal.json").read_text())["phase"], "rolled-back")
            finally:
                service.stop()

    def test_unconfirmed_candidate_stop_keeps_candidate_selected_for_review(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            (root / ".ars-switch-test").touch()
            for release in ("old", "new"):
                dist = root / release / "dist"
                dist.mkdir(parents=True)
                (dist / "server.cjs").touch()
            (root / "project").symlink_to(root / "old")
            service = Service(root, fail=True)
            with patch.object(service, "stop", side_effect=[None, RuntimeError("stop failed")]), \
                 patch.object(service, "stopped", return_value=True):
                with self.assertRaisesRegex(RuntimeError, "stop failed"):
                    simulate_switch(root, service, lambda: True)
            self.assertEqual((root / "project").resolve(), root / "new")
            self.assertEqual(json.loads((root / "switch-journal.json").read_text())["phase"], "manual-recovery-required")

if __name__=="__main__":
    unittest.main()
