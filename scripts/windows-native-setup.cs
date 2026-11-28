using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Diagnostics;
using System.Windows.Forms;
using System.Collections.Generic;

[assembly: AssemblyTitle("ARS Distributor Setup")]
[assembly: AssemblyCompany("RS Nextward")]
[assembly: AssemblyProduct("ARS Distributor")]
[assembly: AssemblyVersion("1.0.0.0")]

internal static class Setup {
    [STAThread]
    static int Main(string[] args) {
        bool verify = args.Length == 1 && args[0] == "--verify-payload";
        try {
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("ARS.Payload.zip"))
            using (var zip = new ZipArchive(stream, ZipArchiveMode.Read)) {
                var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var item in zip.Entries) {
                    var name = item.FullName;
                    if (!name.StartsWith("ARS-Distributor/", StringComparison.Ordinal) ||
                        name.IndexOfAny(new char[] {'\\', ':', '\0', '*', '?', '"', '<', '>', '|'}) >= 0 ||
                        !names.Add(name)) throw new InvalidDataException("Invalid embedded package path.");
                    foreach (var part in name.Split('/')) {
                        if (part.Length == 0 || part == "." || part == ".." || part.EndsWith(".") || part.EndsWith(" "))
                            throw new InvalidDataException("Invalid embedded package path.");
                    }
                    using (var input = item.Open()) { input.CopyTo(Stream.Null); }
                }
                foreach (var required in new string[] {"Setup-ARS-Distributor.vbs", "PILOT-FILES.json", "scripts/setup-wizard.ps1"})
                    if (!names.Contains("ARS-Distributor/" + required)) throw new InvalidDataException("Missing embedded setup file.");
                if (verify) return 0;
                if (args.Length != 0) throw new ArgumentException("Unsupported setup argument.");
                if (MessageBox.Show("Thank you for choosing RS Nextward.\n\nExtract the ARS Distributor pilot setup files and open Setup? Internet access may be required.", "RS Nextward | ARS Distributor Setup", MessageBoxButtons.OKCancel, MessageBoxIcon.Information) != DialogResult.OK) return 0;
                // Keep the extracted source across restart; do not use an auto-deleted temp folder.
                string baseFolder = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string folder = Path.Combine(baseFolder, "ARS-Pilot-Setup-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(folder);
                foreach (var item in zip.Entries) {
                    string target = Path.GetFullPath(Path.Combine(folder, item.FullName));
                    if (!target.StartsWith(folder + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("Package path escapes setup folder.");
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    using (var input = item.Open())
                    using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write)) input.CopyTo(output);
                }
                string root = Path.Combine(folder, "ARS-Distributor");
                var info = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "wscript.exe"));
                info.Arguments = "\"" + Path.Combine(root, "Setup-ARS-Distributor.vbs") + "\"";
                info.WorkingDirectory = root;
                info.UseShellExecute = false;
                using (var process = Process.Start(info)) {
                    if (process == null) throw new InvalidOperationException("Unable to launch Setup.");
                    process.WaitForExit();
                    return process.ExitCode;
                }
            }
        } catch (Exception error) {
            if (!verify) MessageBox.Show("Setup could not complete. Existing business data has not been removed.\n\n" + error.Message, "RS Nextward | Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
