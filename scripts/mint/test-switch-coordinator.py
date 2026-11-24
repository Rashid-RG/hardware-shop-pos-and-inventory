import tempfile
from pathlib import Path
import unittest
from switch_coordinator import simulate_switch

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
    def test_success(self): self.exercise(False,True,"updated","new")
    def test_unhealthy_candidate(self): self.exercise(True,True,"rolled-back","old")
    def test_backup_rejection(self): self.exercise(False,False,"rolled-back","old")

if __name__=="__main__":
    unittest.main()
