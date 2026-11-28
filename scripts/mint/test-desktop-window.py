import unittest
from pathlib import Path
from desktop_window import command

class DesktopWindowTests(unittest.TestCase):
    def test_fixed_local_application(self):
        args=command("/usr/bin/chromium",Path("/home/test/ARS profile"))
        self.assertEqual(args[1],"--app=http://localhost:3000")
        self.assertEqual(args[2],"--user-data-dir=/home/test/ARS profile")
        self.assertNotIn("--no-sandbox",args)

if __name__=="__main__":
    unittest.main()
