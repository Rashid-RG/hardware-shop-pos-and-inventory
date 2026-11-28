"""Verify release signing with disposable keys and a tampered manifest."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("release_signer", Path(__file__).with_name("sign-update-release.py"))
signer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signer)

sys.path.insert(0, str(Path(__file__).parent / "mint"))
mint_spec = importlib.util.spec_from_file_location("mint_updater", Path(__file__).parent / "mint/stage-update.py")
mint_updater = importlib.util.module_from_spec(mint_spec)
mint_spec.loader.exec_module(mint_updater)


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


    def test_mint_staging_requires_exact_signed_version(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary)
            package = source / "package.json"
            package.write_text('{"version":"1.2.3"}')
            mint_updater.verify_package_version(source, "1.2.3")
            for wrong in ("1.2.2", "1.2.3-rc.1", "1.2.4"):
                with self.subTest(version=wrong), self.assertRaisesRegex(ValueError, "does not match"):
                    mint_updater.verify_package_version(source, wrong)


    def test_mint_recheck_rejects_changed_staged_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            staged = Path(temporary)
            package = staged / "package.json"
            package.write_text('{"version":"1.2.3"}')
            archive = staged / mint_updater.ARCHIVE_NAME
            with tarfile.open(archive, "w:gz") as bundle:
                bundle.add(package, arcname="package.json")
            expected = hashlib.sha256(archive.read_bytes()).hexdigest()
            mint_updater.verify_signed_source(staged, expected)
            package.write_text('{"version":"1.2.4"}')
            with self.assertRaisesRegex(ValueError, "Staged source differs"):
                mint_updater.verify_signed_source(staged, expected)
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                mint_updater.verify_signed_source(staged, "0" * 64)


if __name__ == "__main__":
    unittest.main()
