// Internal supervisor executable entry point; not an installer or public maintenance command.
// Must be launched by the trusted coordinator with redirected private stdin.
using System;
using System.Globalization;
using System.IO;

namespace RSNextward.Maintenance {
    internal static class MaintenanceSupervisor {
        public static int Main(string[] args) {
            try {
                int timeout;
                if (!Console.IsInputRedirected || args.Length < 4 ||
                    args[0] != "--private-worker-v1" ||
                    !Int32.TryParse(args[1], NumberStyles.None, CultureInfo.InvariantCulture, out timeout) ||
                    timeout < 1 || timeout > 1200000)
                    return 64;
                string directory = args[2];
                string executable = args[3];
                var workerArgs = new string[args.Length - 4];
                Array.Copy(args, 4, workerArgs, 0, workerArgs.Length);
                using (Stream control = Console.OpenStandardInput()) {
                    CancellationBridge.Run(control, executable, workerArgs, directory, timeout);
                }
                return 0;
            } catch (OperationCanceledException) {
                return 75;
            } catch (Exception) {
                // Do not print command arguments, paths, credentials or native exception details.
                return 70;
            }
        }
    }
}
