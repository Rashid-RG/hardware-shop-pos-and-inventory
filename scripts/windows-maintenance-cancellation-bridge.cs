// Internal bridge for a dedicated supervisor process. No production entry point.
using System;
using System.IO;
using System.Threading;

namespace RSNextward.Maintenance {
    public static class CancellationBridge {
        // The caller supplies a private, exclusively owned control stream.
        // Exactly one byte ('A') authorizes the worker; any subsequent byte,
        // EOF or read failure revokes authorization. No external named endpoint.
        // The supervisor process must exit after Run returns; the background
        // reader can remain blocked until its private stream is closed.
        public static void Run(Stream control, string executable, string[] args, string directory, int timeoutMs) {
            if (control == null || !control.CanRead)
                throw new ArgumentException("Readable private control stream required.");
            if (control.ReadByte() != 65)
                throw new InvalidOperationException("Maintenance authorization unavailable.");
            using (var cancellation = new CancellationTokenSource()) {
                var sync = new object();
                bool finished = false;
                var monitor = new Thread(delegate() {
                    try { control.ReadByte(); }
                    catch (Exception) { /* Read failure also revokes authorization. */ }
                    finally {
                        lock (sync) {
                            if (!finished) cancellation.Cancel();
                        }
                    }
                });
                monitor.IsBackground = true;
                monitor.Start();
                try {
                    SuspendedWorker.Run(executable, args, directory, timeoutMs, cancellation.Token);
                    lock (sync) { cancellation.Token.ThrowIfCancellationRequested(); }
                } finally {
                    lock (sync) { finished = true; }
                }
            }
        }
    }
}
