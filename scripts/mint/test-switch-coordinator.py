import json
import subprocess
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from switch_coordinator import simulate_switch, resume_interrupted_switch
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


    def test_http_readiness_accepts_candidate(self):
        self.exercise_http("1.0.1", "1.0.0", "updated", "new", "completed", [0, 0])

    def test_http_readiness_failure_rolls_back_and_verifies_previous_process(self):
        self.exercise_http("9.9.9", "1.0.0", "rolled-back", "old", "rolled-back", [0, 1, 0])

    def test_unhealthy_previous_release_requires_recovery_review(self):
        self.exercise_http("9.9.9", "9.9.8", None, "old", "manual-recovery-required", [0, 1, 1])

    def exercise_http(self, candidate_version, restarted_version, outcome, selected, phase, results):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            (root / ".ars-switch-test").touch()
            data = root / "business-data"
            data.write_text("historical invoices")
            verifier = Path(__file__).resolve().parent.parent / "verify-installed-release-readiness.mjs"
            for release, version in (("old", "1.0.0"), ("new", candidate_version)):
                server = root / release / "dist/server.cjs"
                server.parent.mkdir(parents=True)
                # Bind an ephemeral loopback port for each process.
                server.write_text(
                    "const http=require('node:http'),fs=require('node:fs');"
                    "const server=http.createServer((req,res)=>res.end(JSON.stringify("
                    "{ok:true,status:'ready',database:'reachable',sourceOfTruth:'normalized',"
                    "buildVersion:" + json.dumps(version) + ",processId:process.pid})));"
                    "server.listen(0,'127.0.0.1',()=>fs.writeFileSync("
                    + json.dumps(str(root / "endpoint")) +
                    ",JSON.stringify({pid:process.pid,port:server.address().port})));"
                )
            (root / "project").symlink_to(root / "old")

            class HttpService(ProcessService):
                def __init__(self, root):
                    super().__init__(root)
                    self.observed = []

                def ready(self):
                    import time
                    expected = "1.0.0" if (self.root / "project").resolve() == self.root / "old" else "1.0.1"
                    endpoint = self.root / "endpoint"
                    for _ in range(250):
                        if self.stopped():
                            return False
                        try:
                            record = json.loads(endpoint.read_text())
                            if record["pid"] == self.process.pid:
                                break
                        except (OSError, ValueError, KeyError):
                            pass
                        time.sleep(0.02)
                    else:
                        return False
                    # Exercise the shared real HTTP verifier rather than
                    # trusting the fixture's port marker as readiness evidence.
                    code = (
                        "import {waitForInstalledRelease} from " + json.dumps(verifier.as_uri()) + ";"
                        "await waitForInstalledRelease(process.argv[1],Number(process.argv[2]),"
                        "{port:Number(process.argv[3]),timeoutMs:2000,intervalMs:20,"
                        "assertActive:async()=>{process.kill(Number(process.argv[2]),0);}});"
                    )
                    result = subprocess.run(
                        ["node", "--input-type=module", "-e", code, expected,
                         str(self.process.pid), str(record["port"])],
                        capture_output=True, timeout=8
                    )
                    self.observed.append((expected, self.process.pid, result.returncode))
                    return result.returncode == 0 and not self.stopped()

            service = HttpService(root)
            try:
                service.start()
                self.assertTrue(service.ready())
                initial_pid = service.process.pid
                previous_server = root / "old/dist/server.cjs"
                if restarted_version != "1.0.0":
                    previous_server.write_text(previous_server.read_text().replace('"1.0.0"', json.dumps(restarted_version)))
                if outcome is None:
                    with self.assertRaisesRegex(RuntimeError, "Previous version failed readiness"):
                        simulate_switch(root, service, lambda: True)
                else:
                    self.assertEqual(simulate_switch(root, service, lambda: True), outcome)
                self.assertEqual((root / "project").resolve(), root / selected)
                self.assertEqual(data.read_text(), "historical invoices")
                expected_versions = ["1.0.0", "1.0.1"]
                if len(results) == 3:
                    expected_versions.append("1.0.0")
                self.assertEqual([item[0] for item in service.observed], expected_versions)
                self.assertEqual([int(code != 0) for _, _, code in service.observed], results)
                self.assertNotEqual(service.process.pid, initial_pid)
                self.assertEqual(json.loads((root / "switch-journal.json").read_text())["phase"], phase)
                self.assertFalse(startup_allowed(root))
            finally:
                service.stop()

    def test_resume_interrupted_switch_at_each_boundary(self):
        from switch_journal import write_journal
        for phase,active in (("backup-verified","old"),("backup-verified","new"),("switched","new"),("rollback-required","new"),("previous-selected","old")):
            with self.subTest(phase=phase,active=active), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp).resolve()
                (root/".ars-switch-test").touch()
                for release in ("old","new"):
                    dist=root/release/"dist"
                    dist.mkdir(parents=True)
                    (dist/"server.cjs").touch()
                (root/"project").symlink_to(root/active)
                (root/"business-data").write_text("original invoices")
                write_journal(root,{"kind":"mint-switch-rehearsal","previous":str(root/"old"),"candidate":str(root/"new"),"phase":phase})
                service=Service(root)
                original=(root/"switch-journal.json").read_bytes()
                with self.assertRaisesRegex(ValueError,"evidence mismatch"):
                    resume_interrupted_switch(root,service,lambda:False,lambda _:True)
                self.assertEqual((root/"switch-journal.json").read_bytes(),original)
                self.assertEqual((root/"project").resolve(),root/active)
                self.assertEqual(resume_interrupted_switch(root,service,lambda:True,lambda path:path==root/"old"),"rolled-back")
                self.assertEqual((root/"project").resolve(),root/"old")
                self.assertEqual((root/"business-data").read_text(),"original invoices")
                self.assertFalse(startup_allowed(root))


    def test_installed_service_adapter_respects_guard_and_release_identity(self):
        from switch_coordinator import InstalledMintService
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            old, new = root/"old", root/"new"
            old.mkdir()
            new.mkdir()
            pointer = root/"project"
            pointer.symlink_to(old)
            adapter = InstalledMintService(root)
            with patch("subprocess.run") as command, patch("maintenance_backup.stopped") as stopped, patch("resume_maintenance.wait_for_current_release") as ready:
                adapter.stop()
                command.assert_called_once_with(["systemctl","--user","stop","ars-hardware.service"], check=True, timeout=180)
                command.reset_mock()
                adapter.bind(old,"1.2.3")
                hold = root/"maintenance-hold.json"
                hold.touch()
                with self.assertRaisesRegex(RuntimeError,"startup guard"):
                    adapter.start()
                command.assert_not_called()
                hold.unlink()
                adapter.start()
                command.assert_called_once_with(["systemctl","--user","start","--no-block","ars-hardware.service"], check=True, timeout=30)
                stopped.assert_called()
                self.assertTrue(adapter.ready())
                ready.assert_called_once_with(old,"1.2.3",state=root)
                pointer.unlink()
                pointer.symlink_to(new)
                with self.assertRaisesRegex(RuntimeError,"pointer changed"):
                    adapter.ready()
                with self.assertRaisesRegex(RuntimeError,"pointer changed"):
                    adapter.start()
                self.assertEqual(command.call_count,1)

if __name__=="__main__":
    unittest.main()
