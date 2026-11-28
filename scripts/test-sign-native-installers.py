#!/usr/bin/env python3
"""Exercise the native installer signer using disposable keys and fake package bytes."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("signer", Path(__file__).with_name("sign-native-installers.py"))
signer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signer)

class NativeSigningTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.private = self.root / "private.pem"
        self.public = self.root / "public.pem"
        subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", str(self.private)], check=True, capture_output=True)
        subprocess.run(["openssl", "pkey", "-in", str(self.private), "-pubout", "-out", str(self.public)], check=True, capture_output=True)
        der = base64.b64decode("".join(self.public.read_text().splitlines()[1:-1]), validate=True)
        self.fingerprint = hashlib.sha256(der).hexdigest()
        self.windows = self.root / "sample.exe"
        self.mint = self.root / "sample.deb"
        for file in (self.windows, self.mint):
            file.write_bytes(file.name.encode())
            file.with_name(file.name + ".sha256").write_text(signer.digest(file) + "  " + file.name)
        self.output = self.root / "output"
    def run_signer(self, fingerprint=None):
        args = ["signer", "--windows", str(self.windows), "--mint", str(self.mint), "--private-key", str(self.private), "--public-key", str(self.public), "--output", str(self.output), "--commit", "a"*40]
        with patch.object(sys, "argv", args), patch.object(signer, "FINGERPRINT", self.fingerprint if fingerprint is None else fingerprint):
            signer.main()
    def test_signed_files_and_tamper_rejection(self):
        self.run_signer()
        self.assertEqual({p.name for p in self.output.iterdir()}, {"ARS-Distributors-Setup.exe", "ARS-Distributors-Setup.deb", "installers.json", "installers.sig"})
        manifest = self.output / "installers.json"
        record = json.loads(manifest.read_text())
        self.assertFalse(record["liveUpdatesApproved"])
        self.assertEqual(record["commit"], "a"*40)
        for item in record["installers"].values():
            self.assertEqual(signer.digest(self.output/item["file"]), item["sha256"])
        manifest.write_bytes(manifest.read_bytes()+b" ")
        result = subprocess.run(["openssl","dgst","-sha256","-verify",str(self.public),"-signature",str(self.output/"installers.sig"),str(manifest)],capture_output=True)
        self.assertNotEqual(result.returncode, 0)
    def test_modified_package_rejected(self):
        self.windows.write_bytes(b"tampered")
        with self.assertRaises(ValueError):
            self.run_signer()
        self.assertFalse(self.output.exists())
    def test_wrong_key_rejected(self):
        with self.assertRaises(ValueError):
            self.run_signer("0"*64)
        self.assertFalse(self.output.exists())
    def test_existing_output_protected(self):
        self.output.mkdir()
        marker = self.output/"keep"
        marker.write_text("keep")
        with self.assertRaises(FileExistsError):
            self.run_signer()
        self.assertEqual(marker.read_text(),"keep")

if __name__ == "__main__":
    unittest.main()
