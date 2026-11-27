import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location("readiness",Path(__file__).with_name("repair-readiness.py"))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Observer:
    @staticmethod
    def sha(raw):
        return hashlib.sha256(raw).hexdigest()

class Tests(unittest.TestCase):
    def fixture(self):
        flags={k:False for k in module.FLAGS}
        binding=("a"*64,"b"*64)
        backup=dict(schema=1,kind="repair-backup-observation",backupEvidenceMatched=True,repairCandidateRestoreTested=False,repairReceiptDigest=binding[0],manifestDigest=binding[1],**flags)
        test=dict(kind="isolated-repair-restore-test",restoreTestPassed=True,authenticatedReadsPassed=True,authenticatedWritesPassed=True,migrationCompatibilityPassed=True,continuousExclusionVerified=False,activationApproved=False,buildFingerprint="c"*64,previousBuildFingerprint="d"*64,candidateRestartPreserved=True,previousRestartPreserved=True,repairSpecificBackwardTested=True,backwardStartupPassed=True,backwardReadsPassed=True,backwardWritesPassed=True,**flags)
        raw={k:json.dumps(v).encode() for k,v in (("backup",backup),("test",test))}
        final=dict(schema=1,kind="mint-repair-rehearsal-observation",scope="isolated-rehearsal-only",liveRepairCompleted=False,rollbackAllowed=False,continuousExclusionVerified=False,backupObservationDigest=Observer.sha(raw["backup"]),testReceiptDigest=Observer.sha(raw["test"]),repairReceiptDigest=binding[0],**flags)
        raw["completion"]=json.dumps(final).encode()
        return binding,raw
    def test_valid_receipts(self):
        binding,raw=self.fixture()
        module.validate_receipts(binding,raw,Observer)
    def test_backward_required(self):
        binding,raw=self.fixture()
        record=json.loads(raw["test"])
        record["backwardWritesPassed"]=False
        raw["test"]=json.dumps(record).encode()
        final=json.loads(raw["completion"])
        final["testReceiptDigest"]=Observer.sha(raw["test"])
        raw["completion"]=json.dumps(final).encode()
        with self.assertRaises(ValueError):
            module.validate_receipts(binding,raw,Observer)
    def test_completion_scope(self):
        for flag in ("liveRepairCompleted","rollbackAllowed","continuousExclusionVerified","scope"):
            binding,raw=self.fixture()
            final=json.loads(raw["completion"])
            final.pop(flag)
            raw["completion"]=json.dumps(final).encode()
            with self.assertRaises(ValueError):
                module.validate_receipts(binding,raw,Observer)
    def test_tampered_test(self):
        binding,raw=self.fixture()
        raw["test"]+=b" "
        with self.assertRaises(ValueError):
            module.validate_receipts(binding,raw,Observer)
    def test_authorization_rejected(self):
        binding,raw=self.fixture()
        record=json.loads(raw["completion"])
        record["activationAllowed"]=True
        raw["completion"]=json.dumps(record).encode()
        with self.assertRaises(ValueError):
            module.validate_receipts(binding,raw,Observer)
if __name__=="__main__":
    unittest.main()
