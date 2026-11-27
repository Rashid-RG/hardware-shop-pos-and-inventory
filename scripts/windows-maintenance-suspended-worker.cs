// Internal Windows worker launcher. No CLI or production maintenance entry point.
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace RSNextward.Maintenance {
    public static class SuspendedWorker {
        [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
        private struct StartupInfo {
            public uint cb;
            public string reserved, desktop, title;
            public uint x,y,xSize,ySize,xCountChars,yCountChars,fillAttribute,flags;
            public ushort showWindow,reserved2Size;
            public IntPtr reserved2,stdin,stdout,stderr;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct ProcessInfo {
            public IntPtr process,thread;
            public uint processId,threadId;
        }
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        private static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes,
            IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory,
            ref StartupInfo startup, out ProcessInfo info);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern uint WaitForSingleObject(IntPtr process, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern bool TerminateProcess(IntPtr process, uint code);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern bool CloseHandle(IntPtr handle);
        private static string Quote(string value) {
            if (value == null || value.IndexOf('\0') >= 0) throw new ArgumentException("Invalid argument.");
            var b = new StringBuilder("\"");
            int slashes = 0;
            foreach (char c in value) {
                if (c == '\\') { slashes++; continue; }
                if (c == '"') b.Append('\\', checked(slashes * 2 + 1));
                else b.Append('\\', slashes);
                b.Append(c);
                slashes = 0;
            }
            b.Append('\\', checked(slashes * 2));
            b.Append('"');
            return b.ToString();
        }

        // Trusted internal executable and arguments only. No shell or inherited handles.
        // This synchronous primitive does not yet provide IPC or abort-signal integration.
        public static void Run(string executable, string[] args, string directory, int timeoutMs) {
            if (String.IsNullOrEmpty(executable) || !Path.IsPathRooted(executable) ||
                !String.Equals(Path.GetFullPath(executable), executable, StringComparison.OrdinalIgnoreCase) ||
                !File.Exists(executable) || !String.Equals(Path.GetExtension(executable), ".exe", StringComparison.OrdinalIgnoreCase) ||
                String.IsNullOrEmpty(directory) || !Path.IsPathRooted(directory) || !Directory.Exists(directory) ||
                args == null || timeoutMs < 1 || timeoutMs > 1200000)
                throw new ArgumentException("Invalid maintenance worker request.");
            var command = new StringBuilder(Quote(executable));
            foreach (string arg in args) command.Append(' ').Append(Quote(arg));
            if (command.Length >= 32767) throw new ArgumentException("Worker command too long.");
            using (var job = new MaintenanceJob()) {
                var startup = new StartupInfo();
                startup.cb = (uint)Marshal.SizeOf(typeof(StartupInfo));
                ProcessInfo info;
                // CREATE_SUSPENDED | CREATE_NO_WINDOW
                if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, false, 0x08000004,
                    IntPtr.Zero, directory, ref startup, out info))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                bool assigned = false;
                bool complete = false;
                try {
                    job.AssignSuspendedWorker(info.process);
                    assigned = true;
                    if (job.ActiveProcesses != 1) throw new InvalidOperationException("Worker containment not verified.");
                    if (ResumeThread(info.thread) != 1) throw new InvalidOperationException("Worker resume failed.");
                    uint wait = WaitForSingleObject(info.process, (uint)timeoutMs);
                    if (wait != 0) throw new InvalidOperationException("Worker wait failed or timed out.");
                    uint code;
                    if (!GetExitCodeProcess(info.process, out code) || code != 0)
                        throw new InvalidOperationException("Worker failed.");
                    if (job.ActiveProcesses != 0) throw new InvalidOperationException("Worker descendants remain active.");
                    complete = true;
                } finally {
                    try {
                        if (!complete) {
                            if (assigned) job.Terminate();
                            else if (!TerminateProcess(info.process, 1)) throw new Win32Exception(Marshal.GetLastWin32Error());
                            if (WaitForSingleObject(info.process, 10000) != 0)
                                throw new InvalidOperationException("Worker termination not verified.");
                        }
                    } finally {
                        CloseHandle(info.thread);
                        CloseHandle(info.process);
                    }
                }
            }
        }
    }
}
