import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location("native",Path(__file__).with_name("native-repair-rehearsal.py"))
native=importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
class Tests(unittest.TestCase):
    def test_namespace_and_readonly_mounts(self):
        args=native.sandbox_args(Path("/test/node"),Path("/test/build"),Path("/test/archive"),Path("/test/helpers"))
        for flag in ("--unshare-all","--die-with-parent","--clearenv","--new-session"):
            self.assertIn(flag,args)
        self.assertNotIn("--share-net",args)
        self.assertNotIn("--bind",args)
        self.assertNotIn("/var/run/docker.sock",args)
        self.assertIn("/recovery.dump",args)
        self.assertIn("/app",args)
        self.assertEqual(args[-2:],["/usr/bin/python3","/worker.py"])
if __name__=="__main__":
    unittest.main()
