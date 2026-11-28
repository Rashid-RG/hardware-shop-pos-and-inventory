# Non-authorizing dedicated shutdown hold. No process control in this helper.
function New-ArsUninstallShutdownHold([string]$project,$instance,[string]$confirmation) {
 if ($confirmation -cne 'STOP POS FOR UNINSTALL BACKUP' -or $instance.schema -ne 1 -or $instance.project -ine $project -or $instance.pid -lt 1 -or $instance.startedUtc -cnotmatch '^[0-9]{1,19}$') {throw 'Matching instance and explicit shutdown confirmation required.'}
 [ordered]@{schema=1;purpose='pre-uninstall backup';project=$project;pid=$instance.pid;startedUtc=$instance.startedUtc;requestedAt=[DateTime]::UtcNow.ToString('o');uninstallId=[guid]::NewGuid().ToString('N');shutdownVerified=$false;activationApproved=$false;applicationRemovalAllowed=$false;databaseDeletionAllowed=$false}
}
