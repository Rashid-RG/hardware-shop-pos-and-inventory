"""Verify release signing with disposable keys and a tampered manifest."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("release_signer", Path(__file__).with_name("sign-update-release.py"))
signer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signer)

sys.path.insert(0, str(Path(__file__).parent / "mint"))
mint_spec = importlib.util.spec_from_file_location("mint_updater", Path(__file__).parent / "mint/stage-update.py")
mint_updater = importlib.util.module_from_spec(mint_spec)
mint_spec.loader.exec_module(mint_updater)


class ReleaseSigningTests(unittest.TestCase):
    def test_publication_prepares_one_complete_commit_without_moving_the_branch(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo = root / "repo"
            repo.mkdir()

            def git(*args):
                return subprocess.check_output(["git", *args], cwd=repo)

            git("init", "-q")
            git("config", "user.name", "ARS release test")
            git("config", "user.email", "release-test@example.invalid")
            (repo / "package.json").write_text('{"version":"1.2.3"}')
            git("add", "package.json")
            git("commit", "-qm", "Application release")
            application = git("rev-parse", "HEAD").decode().strip()
            git("switch", "-qc", "feed")
            git("rm", "-q", "package.json")
            (repo / "feed").mkdir()
            (repo / "feed/index.html").write_text("<!doctype html><title>Updates</title>")
            (repo / "feed/status.json").write_text(json.dumps({
                "product": "ARS Distributors", "channel": "production", "status": "awaiting-signed-release"
            }))
            git("add", "feed")
            git("commit", "-qm", "Update site")
            base = git("rev-parse", "HEAD").decode().strip()

            private, public = root / "private.pem", root / "public.pem"
            subprocess.run(["openssl", "genpkey", "-algorithm", "EC", "-pkeyopt",
                            "ec_paramgen_curve:P-256", "-out", str(private)], check=True)
            subprocess.run(["openssl", "pkey", "-in", str(private), "-pubout", "-out", str(public)], check=True)
            signed = root / "signed"
            signed.mkdir()
            (signed / "release-record.json").write_text(json.dumps({
                "version": "1.2.3", "commit": application, "published": False, "liveUpdatesApproved": False
            }))
            for platform, archive in signer.ARCHIVES.items():
                asset = root / archive
                asset.write_bytes(platform.encode())
                signer.sign_release(platform, "1.2.3", asset, private, public, signed / platform, commit=application)

            def prepare(feed_base):
                return subprocess.run([
                    sys.executable, str(Path(__file__).resolve().with_name("prepare-update-publication.py")),
                    "--feed", str(signed), "--approved-commit", application, "--feed-base", feed_base,
                    "--public-key", str(public),
                ], cwd=repo, capture_output=True, text=True)

            (repo / "feed/index.html").write_text("Uncommitted change")
            git("add", "feed/index.html")
            success = prepare(base)
            self.assertEqual(success.returncode, 0, success.stderr)
            publication = json.loads(success.stdout)["publicationCommit"]
            self.assertEqual(git("rev-parse", publication + "^").decode().strip(), base)
            self.assertEqual(git("rev-parse", "HEAD").decode().strip(), base)
            self.assertEqual(git("show", ":feed/index.html"), b"Uncommitted change")
            self.assertEqual(git("show", publication + ":feed/index.html"), b"<!doctype html><title>Updates</title>")
            self.assertEqual(json.loads(git("show", publication + ":feed/status.json"))["version"], "1.2.3")
            expected = {f"feed/{platform}/{name}" for platform, archive in signer.ARCHIVES.items()
                        for name in (archive, "manifest.json", "manifest.sig")}
            self.assertEqual(set(git("diff", "--name-only", base, publication).decode().splitlines()),
                             expected | {"feed/status.json"})
            for platform, archive in signer.ARCHIVES.items():
                self.assertEqual(git("show", f"{publication}:feed/{platform}/{archive}"), platform.encode())
            self.assertIn("advance the production version", prepare(publication).stderr)
            extra = signed / "private.pem"
            extra.write_bytes(private.read_bytes())
            self.assertIn("inventory", prepare(base).stderr)
            extra.unlink()
            mint = signed / "linux-mint"
            shutil.rmtree(mint)
            signer.sign_release("linux-mint", "1.2.3", root / "release.tar.gz", private, public, mint, commit="9" * 40)
            result = prepare(base)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Signed feed commit mismatch", result.stderr)

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

    def test_retained_mint_publisher_source(self):
        from signed_release_source import verify_publisher_source
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            private,public=root/"key.pem",root/"trust.pem"
            subprocess.run(["openssl","genpkey","-algorithm","EC","-pkeyopt","ec_paramgen_curve:P-256","-out",str(private)],check=True)
            subprocess.run(["openssl","pkey","-in",str(private),"-pubout","-out",str(public)],check=True)
            project=root/"project"
            (project/"scripts").mkdir(parents=True)
            package=project/"package.json"
            package.write_text('{"version":"1.2.3"}')
            helper=project/"scripts/recover.py"
            helper.write_text("original")
            entry=project/"scripts/writer-loss-restore-runner.mjs"
            entry.write_text(
                'import {writeFileSync} from "node:fs";'
                'import {join} from "node:path";'
                'if (process.env.NODE_OPTIONS || process.env.NODE_PATH) throw Error("Inherited loader");'
                'writeFileSync(join(process.argv[2], "observation.txt"), process.argv[3]);')
            runtime=root/"runtime"
            runtime.mkdir()
            archive=root/"release.tar.gz"
            with tarfile.open(archive,"w:gz") as bundle:
                bundle.add(package,arcname="package.json")
                bundle.add(helper,arcname="scripts/recover.py")
                bundle.add(entry,arcname="scripts/writer-loss-restore-runner.mjs")
            output=root/"signed"
            signer.sign_release("linux-mint","1.2.3",archive,private,public,output)
            for source,target in (("manifest.json",".ars-release-manifest.json"),("manifest.sig",".ars-release-manifest.sig"),("release.tar.gz",".ars-release.tar.gz")):
                (project/target).write_bytes((output/source).read_bytes())
            result=verify_publisher_source(project,public)
            self.assertTrue(result["publisherSourceVerified"])
            self.assertFalse(result["executionAllowed"])
            helper.write_text("modified")
            with self.assertRaisesRegex(ValueError,"Staged source differs"):
                verify_publisher_source(project,public)
            helper.write_text("original")
            recovery_spec=importlib.util.spec_from_file_location(
                "trusted_incident_restore", Path(__file__).parent/"mint/run-trusted-incident-restore.py")
            recovery=importlib.util.module_from_spec(recovery_spec)
            recovery_spec.loader.exec_module(recovery)
            node=Path(shutil.which("node")).resolve(strict=True)
            entry.write_text('throw Error("Mutable release entry executed");')
            confirmation="RUN ISOLATED INCIDENT RESTORE"
            with self.assertRaisesRegex(ValueError,"confirmation required"):
                recovery.run(project,runtime,public,node,"")
            observation=runtime/"observation.txt"
            self.assertFalse(observation.exists())
            with patch.dict(os.environ,{"NODE_OPTIONS":"--invalid-option","NODE_PATH":str(project)}):
                recovery.run(project,runtime,public,node,confirmation)
            self.assertEqual(observation.read_text(),confirmation)
            observation.unlink()
            sig=project/".ars-release-manifest.sig"
            sig.write_bytes(b"invalid")
            with self.assertRaises(subprocess.CalledProcessError):
                verify_publisher_source(project,public)
            with self.assertRaises(subprocess.CalledProcessError):
                recovery.run(project,runtime,public,node,confirmation)
            self.assertFalse(observation.exists())

if __name__ == "__main__":
    unittest.main()
