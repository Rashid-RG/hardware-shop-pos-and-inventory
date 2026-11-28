import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import repair_native_probe as probe

class Tests(unittest.TestCase):
    def test_nonexecuting_check(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            node=root/"runtime"
            node.write_text("fixture")
            node.chmod(0o700)
            (root/"node").symlink_to(node)
            calls=[]
            def fake_run(args,**kwargs):
                calls.append((args,kwargs))
                class Result:
                    stdout=json.dumps({"version":"22.12.0","abi":"127","platform":"linux","arch":"x64"}) if args[1]=="-e" else ""
                return Result()
            with patch.object(probe,"verify_retained_build",return_value=root),patch.object(probe.platform,"system",return_value="Linux"),patch.object(probe.platform,"machine",return_value="x86_64"),patch.object(probe.subprocess,"run",side_effect=fake_run):
                result=probe.inspect_native(root,root,"a"*64)
            self.assertTrue(result["serverSyntaxPassed"])
            self.assertFalse(result["nativeStartupVerified"])
            self.assertFalse(result["activationAllowed"])
            self.assertEqual(calls[1][0],[str(node),"--check",str(root/"dist/server.cjs")])
            self.assertNotIn("DATABASE_URL",calls[1][1]["env"])
            self.assertNotIn("NODE_OPTIONS",calls[1][1]["env"])
    def test_unregistered_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with patch.object(probe,"verify_retained_build",return_value=root),patch.object(probe.platform,"system",return_value="Linux"),patch.object(probe.platform,"machine",return_value="x86_64"):
                with self.assertRaises(ValueError):
                    probe.inspect_native(root,root,"a"*64)
if __name__=="__main__":
    unittest.main()
