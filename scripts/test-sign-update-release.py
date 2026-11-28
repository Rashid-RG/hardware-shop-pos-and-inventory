"""Verify release signing with disposable keys and a tampered manifest."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("release_signer", Path(__file__).with_name("sign-update-release.py"))
signer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signer)


class ReleaseSigningTests(unittest.TestCase):
    def test_platform_bundles_and_tamper_rejection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            private, public = root / "test-key.pem", root / "test-public.pem"
            subprocess.run(["openssl", "genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256",
                            "-out", str(private)], check=True)
            subprocess.run(["openssl", "pkey", "-in", str(private), "-pubout", "-out", str(public)], check=True)
            for platform, name in signer.ARCHIVES.items():
                with self.subTest(platform=platform):
                    archive = root / name
                    archive.write_bytes(b"disposable updater fixture")
                    output = root / platform
                    signer.sign_release(platform, "1.2.3", archive, private, public, output)
                    manifest = output / "manifest.json"
                    data = json.loads(manifest.read_text())
                    self.assertEqual(data["platform"], platform)
                    self.assertEqual(data["sha256"], hashlib.sha256((output / name).read_bytes()).hexdigest())
                    self.assertEqual({p.name for p in output.iterdir()}, {name, "manifest.json", "manifest.sig"})
                    with self.assertRaises(FileExistsError):
                        signer.sign_release(platform, "1.2.3", archive, private, public, output)
                    manifest.write_text(manifest.read_text().replace("1.2.3", "9.9.9"))
                    result = subprocess.run(["openssl", "dgst", "-sha256", "-verify", str(public),
                                             "-signature", str(output / "manifest.sig"), str(manifest)],
                                            capture_output=True)
                    self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
