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
            (staged / "dist").mkdir()
            (staged / "dist/server.cjs").write_text("// generated")
            mint_updater.verify_signed_source(staged, expected)
            extra = staged / "unsigned.ts"
            extra.write_text("// unexpected")
            with self.assertRaisesRegex(ValueError, "Unexpected staged source entry"):
                mint_updater.verify_signed_source(staged, expected)
            extra.unlink()
            package.chmod(0o700)
            with self.assertRaisesRegex(ValueError, "executable permission differs"):
                mint_updater.verify_signed_source(staged, expected)
            package.chmod(0o600)
            package.write_text('{"version":"1.2.4"}')
            with self.assertRaisesRegex(ValueError, "Staged source differs"):
                mint_updater.verify_signed_source(staged, expected)
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                mint_updater.verify_signed_source(staged, "0" * 64)


    def test_prepare_dual_platform_feed(self):
        from unittest.mock import patch
        spec=importlib.util.spec_from_file_location("feed",Path(__file__).with_name("prepare-update-feed.py"))
        feed=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(feed)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            private,public=root/"private.pem",root/"public.pem"
            subprocess.run(["openssl","genpkey","-algorithm","EC","-pkeyopt","ec_paramgen_curve:P-256","-out",str(private)],check=True)
            subprocess.run(["openssl","pkey","-in",str(private),"-pubout","-out",str(public)],check=True)
            commit="a"*40
            files={"package.json":b'{"version":"1.2.3"}',"package-lock.json":b"{}","scripts/mint/compose.yaml":b"fixture","scripts/windows-pilot-compose.yml":b"fixture",".env.local":b"excluded"}
            def git(*args):
                if args[0]=="rev-parse": return commit.encode()
                if args[0]=="show": return files["package.json"]
                if args[0]=="ls-tree": return b"".join(("100644 blob "+name+"\t"+name+"\0").encode() for name in files)
                if args[0]=="cat-file": return files[args[-1]]
                raise AssertionError(args)
            with patch.object(feed,"git",side_effect=git):
                output=root/"feed"
                feed.prepare(commit,"1.2.3",private,public,output)
                import zipfile
                with zipfile.ZipFile(output/"windows/release.zip") as archive:
                    self.assertEqual(set(archive.namelist()),set(files)-{".env.local"})
                with tarfile.open(output/"linux-mint/release.tar.gz") as archive:
                    self.assertEqual(set(archive.getnames()),set(files)-{".env.local"})
                self.assertFalse(json.loads((output/"release-record.json").read_text())["published"])
                self.assertTrue(feed.verify_feed(output,"1.2.3",public))
                verify_command=[sys.executable,str(Path(__file__).with_name("verify-update-feed.py")),"--feed",str(output),"--version","1.2.3","--public-key",str(public)]
                result=subprocess.run(verify_command,capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stderr)
                extra=output/"private.pem"
                extra.write_text("unexpected")
                self.assertNotEqual(subprocess.run(verify_command,capture_output=True).returncode,0)
                extra.unlink()
                payload=output/"windows/release.zip"
                original=payload.read_bytes()
                payload.write_bytes(original+b"tampered")
                with self.assertRaisesRegex(ValueError,"Signed feed asset mismatch"):
                    feed.verify_feed(output,"1.2.3",public)
                self.assertNotEqual(subprocess.run(verify_command,capture_output=True).returncode,0)
                payload.write_bytes(original)
                self.assertTrue(feed.verify_feed(output,"1.2.3",public))
                with self.assertRaises(FileExistsError):
                    feed.prepare(commit,"1.2.3",private,public,output)
                with self.assertRaises(ValueError):
                    feed.prepare(commit,"1.2.4",private,public,root/"wrong")

if __name__ == "__main__":
    unittest.main()
