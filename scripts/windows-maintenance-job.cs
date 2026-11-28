// Internal native containment primitive. No application entry point or removal action.
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace RSNextward.Maintenance {
    public sealed class MaintenanceJob : IDisposable {
        private sealed class JobHandle : SafeHandleZeroOrMinusOneIsInvalid {
            public JobHandle() : base(true) {}
            protected override bool ReleaseHandle() { return CloseHandle(handle); }
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct BasicLimits {
            public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters {
            public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
            public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct ExtendedLimits {
            public BasicLimits BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct Accounting {
            public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
            public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
        }
        [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
        private static extern JobHandle CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern bool SetInformationJobObject(JobHandle job, int infoClass, ref ExtendedLimits limits, uint length);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern bool AssignProcessToJobObject(JobHandle job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern bool QueryInformationJobObject(JobHandle job, int infoClass, out Accounting info, uint length, IntPtr returnedLength);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern bool TerminateJobObject(JobHandle job, uint exitCode);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern bool CloseHandle(IntPtr handle);

        private readonly JobHandle job;
        public MaintenanceJob() {
            job = CreateJobObject(IntPtr.Zero, null);
            if (job.IsInvalid) {
                int error = Marshal.GetLastWin32Error();
                job.Dispose();
                throw new Win32Exception(error);
            }
            var limits = new ExtendedLimits();
            // Kill on last handle close; do not permit breakaway.
            limits.BasicLimitInformation.LimitFlags = 0x00002000;
            if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits)))) {
                int error = Marshal.GetLastWin32Error();
                job.Dispose();
                throw new Win32Exception(error);
            }
        }
        // Only for a newly created suspended worker, before its first instruction.
        // The future launcher must own the process handle and verify assignment
        // before resuming; assigning an already-running worker is not safe containment.
        internal void AssignSuspendedWorker(IntPtr process) {
            if (process == IntPtr.Zero || process == new IntPtr(-1)) throw new ArgumentException("Invalid worker handle.");
            if (!AssignProcessToJobObject(job, process)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        public uint ActiveProcesses {
            get {
                Accounting info;
                if (!QueryInformationJobObject(job, 1, out info, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                return info.ActiveProcesses;
            }
        }
        public void Terminate() {
            if (!TerminateJobObject(job, 1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        public void Dispose() { job.Dispose(); }
    }
}
