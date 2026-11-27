"""Read-only uninstall planning. No deletion, service control or database access."""
import os
from pathlib import Path
import stat
from startup_guard import startup_allowed

STATE=Path.home()/".local/share/ars-hardware"

def plain(path, directory):
    if path.resolve(strict=True)!=path:
        raise ValueError("Linked storage or installation.")
    s=path.lstat()
    if s.st_uid!=os.getuid() or not (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)):
        raise ValueError("Invalid owned installation entry.")

def inspect(state, project):
    plain(state,True)
    plain(project,True)
    pointer=state/"project"
    if not pointer.is_symlink() or pointer.resolve(strict=True)!=project:
        raise ValueError("Managed installation required.")
    runtime=state/"runtime"
    plain(runtime,True)
    # Reject nested storage or installation directories. Removing a parent
    # installation must never remove its own business storage.
    if project==state or project.is_relative_to(state) or state.is_relative_to(project):
        raise ValueError("Independent installation and runtime required.")
    for name in (".env.local","uploads","backups"):
        target=runtime/name
        plain(target,name!=".env.local")
        mapping=project/name
        if not mapping.is_symlink() or mapping.resolve(strict=True)!=target:
            raise ValueError("Permanent runtime mapping could not be verified.")
    for name in ("dist/server.cjs","dist/index.html"):
        plain(project/name,False)
    if not startup_allowed(state):
        raise ValueError("Resolve maintenance evidence before uninstall planning.")
    if not pointer.is_symlink() or pointer.resolve(strict=True)!=project:
        raise ValueError("Installation changed.")
    return {"schema":1,"kind":"mint-uninstall-preview","installation":str(project),
            "retainedRuntime":str(runtime),"runtimeMappingsMatched":True,
            "databaseDeletionAllowed":False,"applicationRemovalAllowed":False,
            "serviceRemovalAllowed":False,"backupVerified":False,
            "installationOwnershipCertified":False,"uninstalled":False}

def main():
    from setup_ui import SetupUI
    import importlib.util
    import subprocess
    if os.geteuid()==0:
        raise ValueError("Desktop user required.")
    project=(STATE/"project").resolve(strict=True)
    if Path(__file__).resolve().parents[2]!=project:
        raise ValueError("Active installation required.")
    ui=SetupUI(project,"RS Nextward | ARS Distributor Uninstall Wizard")
    if not ui.page("Welcome to the Uninstall Wizard",
        "Thank you for choosing RS Nextward. This wizard reviews application removal without deleting your business records. Nothing is removed during this preview.","Review installation"):
        return
    # Existing protected update recovery is reviewed separately: it has a
    # maintenance hold, so ordinary uninstall layout inspection would reject it.
    if os.path.lexists(STATE/"maintenance-hold.json"):
        if not ui.page("Review existing protected backup",
            "An existing maintenance hold was detected. Review its protected update recovery evidence. This does not certify a final uninstall backup or permit removal.","Select recovery"):
            return
        selected=subprocess.run(["zenity","--file-selection","--directory","--filename="+str(STATE/"update-recovery")+"/"],capture_output=True,text=True)
        if selected.returncode:
            return
        try:
            spec=importlib.util.spec_from_file_location("uninstall_backup",Path(__file__).with_name("uninstall-backup-review.py"))
            module=importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            module.inspect(Path(selected.stdout.strip()))
            ui.page("Protected backup evidence matched","Existing protected update backup and restoration evidence matched. A dedicated final uninstall backup and continuous writer protection are not yet certified. No removal performed.","Finish")
        except (OSError,ValueError,RuntimeError,KeyError,TypeError,subprocess.SubprocessError):
            ui.page("Backup review blocked","Missing or stale protected recovery evidence. Maintenance remains active. No removal performed.","Close")
        return
    try:
        plan=inspect(STATE,project)
    except (OSError,ValueError,RuntimeError):
        ui.page("Removal planning blocked","The installation or permanent storage could not be verified. All files remain unchanged. Contact RS Nextward support.","Close")
        return
    if not ui.page("Preserve your business",
        "Application: "+plan["installation"]+"\n\nPermanent storage: "+plan["retainedRuntime"]+
        "\n\nDatabase, customer accounts, inventory, invoices, documents, settings and backups must be retained. PostgreSQL and shared prerequisites will not be removed. Permanent data deletion is disabled.","Review requirements"):
        return
    try:
        from installation_identity import review
        review(STATE,project)
        identity="Recorded fresh-install tree identity matched. Exclusive ownership is not yet certified."
    except (OSError,ValueError,RuntimeError,KeyError,TypeError):
        identity="Fresh-install identity missing or changed. No removal permitted."
    ui.page("Removal is not yet enabled",
        identity+"\n\nPermanent runtime mappings matched. A verified final backup, installation ownership certification and service shutdown verification are still required before removal can be enabled.\n\nNo application, service, file or database was removed.","Finish")

if __name__=="__main__":
    main()
