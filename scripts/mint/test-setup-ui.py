#!/usr/bin/env python3
import pathlib
import unittest
from setup_ui import logo_bytes, parse_stage, STAGES

class SetupProtocolTests(unittest.TestCase):
    def test_logo(self):
        self.assertTrue(logo_bytes(pathlib.Path(__file__).resolve().parents[2]).startswith(b"\x89PNG"))
    def test_all_milestones(self):
        value=0
        for i in range(1,len(STAGES)+1):
            value=parse_stage("ARS_SETUP_STAGE "+str(i),value)
        self.assertEqual(value,5)
    def test_reject_skips_duplicates_and_invalid(self):
        for message,value in [("ARS_SETUP_STAGE 2",0),("ARS_SETUP_STAGE 1",1),("ARS_SETUP_STAGE 6",5),("ARS_SETUP_STAGE nope",0)]:
            with self.assertRaises(RuntimeError):
                parse_stage(message,value)
    def test_ignore_other_output(self):
        self.assertEqual(parse_stage("npm output",2),2)
    def test_install_script_emits_each_milestone(self):
        script=pathlib.Path(__file__).with_name("install.sh").read_text()
        markers=[line.strip() for line in script.splitlines() if line.startswith('echo "ARS_SETUP_STAGE ')]
        self.assertEqual(markers,[f'echo "ARS_SETUP_STAGE {i}"' for i in range(1,6)])

if __name__=="__main__":
    unittest.main()
