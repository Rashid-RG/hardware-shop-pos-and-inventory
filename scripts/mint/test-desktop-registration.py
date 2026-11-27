import tempfile
import unittest
from pathlib import Path
from desktop_registration import resources,preflight,record,review
class Tests(unittest.TestCase):
    def test_registration(self):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp).resolve()
            desktop=home/"Desktop"
            project=home/"app"
            state=home/".local/share/ars-hardware"
            state.mkdir(parents=True)
            project.mkdir()
            (state/"project").symlink_to(project)
            preflight(home,desktop)
            for p in resources(home,desktop):
                p.parent.mkdir(parents=True,exist_ok=True)
                p.write_text("fixture")
            for name in ("scripts/mint/ars-hardware.service","public/ars-official.svg"):
                p=project/name
                p.parent.mkdir(parents=True,exist_ok=True)
                p.write_text("fixture")
            unit=home/".config/systemd/user/ars-hardware.service"
            enabled=unit.parent/"default.target.wants/ars-hardware.service"
            enabled.parent.mkdir()
            enabled.symlink_to(unit)
            record(home,desktop,project)
            self.assertTrue(review(home,desktop,project)["registrationMatched"])
            self.assertFalse(review(home,desktop,project)["serviceRemovalAllowed"])
            with self.assertRaises(ValueError):
                preflight(home,desktop)
            link=desktop/"ars-hardware.desktop"
            link.write_text("unrelated")
            with self.assertRaises(ValueError):
                review(home,desktop,project)
            self.assertEqual(link.read_text(),"unrelated")
if __name__=="__main__":
    unittest.main()
