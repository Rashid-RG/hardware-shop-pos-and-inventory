"""Pure, non-authorizing final uninstall observation review."""
import re

FLAGS = ("applicationRemovalAllowed", "databaseDeletionAllowed", "serviceRemovalAllowed",
         "uninstalled", "finalUninstallBackupVerified", "continuousExclusionVerified")


def review(observation, uninstall_id, archive, evidence, members):
    """Compare a restore observation with independently collected current digests.

    This is not a live shutdown check or continuous exclusion certification.
    """
    if not isinstance(uninstall_id, str) or not re.fullmatch(r"[a-f0-9]{32}", uninstall_id):
        raise ValueError("Invalid uninstall identity.")
    if observation.get("schema") != 1 or observation.get("kind") != "mint-uninstall-restore-observation" or observation.get("uninstallId") != uninstall_id:
        raise ValueError("Restore observation identity mismatch.")
    if any(observation.get(flag) is not False for flag in FLAGS):
        raise ValueError("Unexpected authorization.")
    if any(observation.get(flag) is not True for flag in ("isolatedRestorePassed", "allPublicTableFingerprintsMatched", "uploadArchiveIntegrityVerified")):
        raise ValueError("Incomplete restore observation.")
    for key, minimum in (("restoredTableCount", 5), ("uploadMemberCount", 0)):
        if type(observation.get(key)) is not int or observation[key] < minimum:
            raise ValueError("Invalid restore count.")
    if not isinstance(evidence, dict) or set(evidence) != {"shutdown", "hold", "meta", "receipt"}:
        raise ValueError("Incomplete shutdown evidence.")
    if not isinstance(archive, str) or not re.fullmatch(r"ars-mint-[A-Za-z0-9_-]+-with-uploads\.dump", archive):
        raise ValueError("Invalid archive.")
    if not isinstance(members, dict) or archive not in members or len(members) < 5:
        raise ValueError("Incomplete archive evidence.")
    for actual, recorded in ((evidence, observation.get("evidenceDigests")), (members, observation.get("archiveMemberDigests"))):
        if any(not isinstance(v, str) or not re.fullmatch(r"[a-f0-9]{64}", v) for v in actual.values()) or actual != recorded:
            raise ValueError("Recovery evidence mismatch.")
    if observation.get("archiveSha256") != members[archive]:
        raise ValueError("Archive digest mismatch.")
    return {"schema": 1, "kind": "mint-final-uninstall-evidence-review",
            "uninstallId": uninstall_id, "restoreObservationMatched": True,
            "evidenceDigests": dict(evidence), "archiveMemberDigests": dict(members),
            **{flag: False for flag in FLAGS}}
