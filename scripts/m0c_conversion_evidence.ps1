[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("RunA", "RunB", "Cleanup", "SelfTest")]
    [string]$Mode,

    [string]$BundleRoot,
    [string]$StatePath,
    [string]$PublishRoot,
    [string]$ExpectedArtifactId,
    [string]$ExpectedArtifactDigest,
    [string]$ExpectedSourceSha,
    [string]$ExpectedManifestSha,
    [string]$RepresentativeSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ArchiveUrl = "https://mc-tca-01.s3.us-west-2.amazonaws.com/ProteoWizard/bt83/4105969/pwiz-bin-windows-x86_64-vc145-release-3_0_26204_a09eea9.tar.bz2"
$ArchiveBytes = 97078806L
$ArchiveSha256 = "A0B92B40456E080B1CB5CBEDAE0B95664F43FE3B723972FE388A60E0341564E2"
$MsConvertSha256 = "4FEB0BA85D29E701234608CC502DF480DE1BC6C0DD2F715E4C12CB0FDEBB8087"
$MsAccessSha256 = "71AEAE17FD55F58023DC104DEFC32CE6C6FDFEFC4E8068FCCFA1906E9C22CB38"
$FixtureUrl = "https://raw.githubusercontent.com/ProteoWizard/pwiz/a09eea91209131f6aa487f7316647fc536188c19/example_data/tiny.pwiz.1.1.mzML"
$FixtureBytes = 25072L
$FixtureSha256 = "711AC14B666F14817C208BD4D39B738E96AC827574C4639D8F8F6EEBBFDE9C83"

# The representative fixture identity. Its file name is a sample identifier and
# never reaches published evidence; every record uses the alias below.
$RepresentativeAccession = "PXD081190"
$RepresentativeFileName = "BBM_506_P110_31_MIA_004_30_calibrated.mzML"
$RepresentativeUrl = "https://ftp.pride.ebi.ac.uk/pride/data/archive/2026/07/PXD081190/BBM_506_P110_31_MIA_004_30_calibrated.mzML"
$RepresentativeBytes = 208408454L
$RepresentativeAlias = "<representative-fixture>"
$RepresentativeLicense = "Creative Commons Public Domain (CC0)"
$PrideProjectApi = "https://www.ebi.ac.uk/pride/ws/archive/v3/projects/PXD081190"
$PrideFilesApi = "https://www.ebi.ac.uk/pride/ws/archive/v3/projects/PXD081190/files"
$ApprovedFixtureHosts = @("ftp.pride.ebi.ac.uk", "raw.githubusercontent.com")

$ExpectedArchiveMembers = 265
$ExpectedExtractedItems = 264
$ExpectedRelease = "3.0.26204"
$RemoteInteractiveDenyRight = "SeDenyRemoteInteractiveLogonRight"
$RuntimePrefix = "mscanvas-m0c-"
$RuntimeMarker = ".mscanvas-m0c-runtime"
$MaximumCaptureBytes = 8MB
$MinimumFreeDiskBytes = 2GB

# Deterministic repeated-navigation sequence. Knuth's multiplicative constant is
# used only to spread indices reproducibly; no randomness is involved.
$NavigationSequenceLength = 24
$NavigationMultiplier = 2654435761L
$NavigationPasses = 3

function Stop-Evidence {
    param([Parameter(Mandatory = $true)][string]$Code)
    throw "M0C:$Code"
}

function Get-StableFailureCode {
    param([Parameter(Mandatory = $true)][System.Management.Automation.ErrorRecord]$ErrorRecord)
    if ($ErrorRecord.Exception.Message -match '^M0C:([a-z0-9_]+)$') {
        return $Matches[1]
    }
    return "unexpected_orchestration_failure"
}

function Get-StableEvidenceToken {
    param(
        [AllowEmptyString()][string]$Value,
        [Parameter(Mandatory = $true)][string]$Fallback
    )
    if ($Value -cmatch '^[a-z][a-z0-9_]{0,63}$') { return $Value }
    return $Fallback
}

function Write-StableEvidenceFailure {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("run", "publication", "publication_fallback", "cleanup", "cleanup_attestation")]
        [string]$Kind,
        [AllowEmptyString()][string]$Stage,
        [Parameter(Mandatory = $true)][string]$Code
    )
    $safeStage = Get-StableEvidenceToken -Value $Stage -Fallback "unknown_stage"
    $safeCode = Get-StableEvidenceToken -Value $Code -Fallback "unexpected_orchestration_failure"
    Write-Host "M0C $Kind blocked stage=$safeStage code=$safeCode"
}

function Write-Stage {
    param([Parameter(Mandatory = $true)][string]$Name)
    $script:CurrentStage = $Name
    Write-Host "M0C evidence stage: $Name"
}

function Add-NativeRuntimeTypes {
    if ("MSCanvas.M0Evidence.SecureLauncher" -as [type]) {
        return
    }

    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Principal;
using System.Text;

namespace MSCanvas.M0Evidence
{
    public sealed class LaunchResult
    {
        public int ExitCode { get; internal set; }
        public long ElapsedMilliseconds { get; internal set; }
        public byte[] Stdout { get; internal set; } = Array.Empty<byte>();
        public byte[] Stderr { get; internal set; } = Array.Empty<byte>();
        public long StdoutTotalBytes { get; internal set; }
        public long StderrTotalBytes { get; internal set; }
        public bool StdoutTruncated { get; internal set; }
        public bool StderrTruncated { get; internal set; }
        public bool TimedOut { get; internal set; }
        public bool UserSidVerified { get; internal set; }
        public bool AdministratorsGroupEnabled { get; internal set; }
        public bool Elevated { get; internal set; }
        public int IntegrityRid { get; internal set; }
        public bool JobAssignedBeforeResume { get; internal set; }
        public bool LoadUserProfile { get { return false; } }
    }

    public static class SecureLauncher
    {
        private const uint CREATE_SUSPENDED = 0x00000004;
        private const uint CREATE_NO_WINDOW = 0x08000000;
        private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        private const uint STARTF_USESTDHANDLES = 0x00000100;
        private const uint GENERIC_READ = 0x80000000;
        private const uint GENERIC_WRITE = 0x40000000;
        private const uint FILE_SHARE_READ = 0x00000001;
        private const uint FILE_SHARE_WRITE = 0x00000002;
        private const uint CREATE_ALWAYS = 2;
        private const uint OPEN_EXISTING = 3;
        private const uint FILE_ATTRIBUTE_TEMPORARY = 0x00000100;
        private const uint TOKEN_QUERY = 0x0008;
        private const int TokenGroups = 2;
        private const int TokenElevation = 20;
        private const int TokenIntegrityLevel = 25;
        private const uint SE_GROUP_ENABLED = 0x00000004;
        private const uint SE_GROUP_USE_FOR_DENY_ONLY = 0x00000010;
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        private const int JobObjectExtendedLimitInformation = 9;
        private const uint WAIT_OBJECT_0 = 0;
        private const uint WAIT_TIMEOUT = 258;
        private const uint INFINITE = 0xffffffff;
        private static readonly IntPtr InvalidHandleValue = new IntPtr(-1);

        [StructLayout(LayoutKind.Sequential)]
        private struct SECURITY_ATTRIBUTES
        {
            public int nLength;
            public IntPtr lpSecurityDescriptor;
            [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFO
        {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public uint dwX;
            public uint dwY;
            public uint dwXSize;
            public uint dwYSize;
            public uint dwXCountChars;
            public uint dwYCountChars;
            public uint dwFillAttribute;
            public uint dwFlags;
            public short wShowWindow;
            public short cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public uint dwProcessId;
            public uint dwThreadId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct SID_AND_ATTRIBUTES
        {
            public IntPtr Sid;
            public uint Attributes;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct TOKEN_MANDATORY_LABEL
        {
            public SID_AND_ATTRIBUTES Label;
        }

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CreateProcessWithLogonW(
            string lpUsername,
            string lpDomain,
            IntPtr lpPassword,
            int dwLogonFlags,
            string lpApplicationName,
            StringBuilder lpCommandLine,
            uint dwCreationFlags,
            IntPtr lpEnvironment,
            string lpCurrentDirectory,
            ref STARTUPINFO lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateFileW(
            string lpFileName,
            uint dwDesiredAccess,
            uint dwShareMode,
            ref SECURITY_ATTRIBUTES lpSecurityAttributes,
            uint dwCreationDisposition,
            uint dwFlagsAndAttributes,
            IntPtr hTemplateFile);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool GetTokenInformation(
            IntPtr TokenHandle,
            int TokenInformationClass,
            IntPtr TokenInformation,
            int TokenInformationLength,
            out int ReturnLength);

        [DllImport("advapi32.dll")]
        private static extern IntPtr GetSidSubAuthorityCount(IntPtr pSid);

        [DllImport("advapi32.dll")]
        private static extern IntPtr GetSidSubAuthority(IntPtr pSid, uint nSubAuthority);

        [DllImport("advapi32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool EqualSid(IntPtr pSid1, IntPtr pSid2);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(
            IntPtr hJob,
            int JobObjectInfoClass,
            IntPtr lpJobObjectInfo,
            uint cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint ResumeThread(IntPtr hThread);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateJobObject(IntPtr hJob, uint uExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);

        public static LaunchResult Run(
            string username,
            SecureString password,
            string expectedUserSid,
            string applicationPath,
            string[] arguments,
            IDictionary<string, string> environment,
            string workingDirectory,
            string captureDirectory,
            int timeoutMilliseconds,
            long maximumCaptureBytes)
        {
            if (String.IsNullOrWhiteSpace(username) || password == null || password.Length == 0)
                throw new ArgumentException("A temporary local account credential is required.");
            if (!Path.IsPathRooted(applicationPath) || !File.Exists(applicationPath))
                throw new ArgumentException("The application path must name an existing absolute file.");
            if (!Path.IsPathRooted(workingDirectory) || !Directory.Exists(workingDirectory))
                throw new ArgumentException("The working directory must be an existing absolute directory.");
            if (!Path.IsPathRooted(captureDirectory) || !Directory.Exists(captureDirectory))
                throw new ArgumentException("The capture directory must be an existing absolute directory.");
            if (timeoutMilliseconds <= 0 || maximumCaptureBytes <= 0)
                throw new ArgumentOutOfRangeException();

            string commandLineText = BuildCommandLine(applicationPath, arguments ?? Array.Empty<string>());
            if (commandLineText.Length + 1 > 1024)
                throw new ArgumentException("The CreateProcessWithLogonW command line exceeds its documented limit.");

            string nonce = Guid.NewGuid().ToString("N");
            string stdoutPath = Path.Combine(captureDirectory, ".capture-" + nonce + ".stdout");
            string stderrPath = Path.Combine(captureDirectory, ".capture-" + nonce + ".stderr");
            IntPtr passwordPointer = IntPtr.Zero;
            IntPtr environmentPointer = IntPtr.Zero;
            IntPtr stdoutHandle = IntPtr.Zero;
            IntPtr stderrHandle = IntPtr.Zero;
            IntPtr stdinHandle = IntPtr.Zero;
            IntPtr tokenHandle = IntPtr.Zero;
            IntPtr jobHandle = IntPtr.Zero;
            PROCESS_INFORMATION process = new PROCESS_INFORMATION();
            bool processCreated = false;
            bool processCompleted = false;

            try
            {
                SECURITY_ATTRIBUTES inheritable = new SECURITY_ATTRIBUTES
                {
                    nLength = Marshal.SizeOf<SECURITY_ATTRIBUTES>(),
                    lpSecurityDescriptor = IntPtr.Zero,
                    bInheritHandle = true
                };
                stdoutHandle = CreateFileW(stdoutPath, GENERIC_WRITE, FILE_SHARE_READ,
                    ref inheritable, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY, IntPtr.Zero);
                stderrHandle = CreateFileW(stderrPath, GENERIC_WRITE, FILE_SHARE_READ,
                    ref inheritable, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY, IntPtr.Zero);
                stdinHandle = CreateFileW("NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                    ref inheritable, OPEN_EXISTING, 0, IntPtr.Zero);
                ThrowIfInvalidHandle(stdoutHandle, "create stdout capture");
                ThrowIfInvalidHandle(stderrHandle, "create stderr capture");
                ThrowIfInvalidHandle(stdinHandle, "open NUL stdin");

                STARTUPINFO startup = new STARTUPINFO
                {
                    cb = Marshal.SizeOf<STARTUPINFO>(),
                    dwFlags = STARTF_USESTDHANDLES,
                    hStdInput = stdinHandle,
                    hStdOutput = stdoutHandle,
                    hStdError = stderrHandle
                };
                passwordPointer = Marshal.SecureStringToGlobalAllocUnicode(password);
                environmentPointer = BuildEnvironmentBlock(environment);
                StringBuilder commandLine = new StringBuilder(commandLineText);
                uint creationFlags = CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT;
                if (!CreateProcessWithLogonW(username, ".", passwordPointer, 0, applicationPath,
                    commandLine, creationFlags, environmentPointer, workingDirectory, ref startup, out process))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcessWithLogonW failed");
                processCreated = true;

                CloseHandle(stdoutHandle); stdoutHandle = IntPtr.Zero;
                CloseHandle(stderrHandle); stderrHandle = IntPtr.Zero;
                CloseHandle(stdinHandle); stdinHandle = IntPtr.Zero;

                if (!OpenProcessToken(process.hProcess, TOKEN_QUERY, out tokenHandle))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcessToken failed");
                LaunchResult result = VerifyToken(tokenHandle, expectedUserSid);

                jobHandle = CreateJobObject(IntPtr.Zero, null);
                ThrowIfInvalidHandle(jobHandle, "create Job Object");
                ConfigureKillOnClose(jobHandle);
                if (!AssignProcessToJobObject(jobHandle, process.hProcess))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "AssignProcessToJobObject failed");
                result.JobAssignedBeforeResume = true;

                Stopwatch timer = Stopwatch.StartNew();
                if (ResumeThread(process.hThread) == UInt32.MaxValue)
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "ResumeThread failed");
                CloseHandle(process.hThread); process.hThread = IntPtr.Zero;

                uint wait = WaitForSingleObject(process.hProcess, (uint)timeoutMilliseconds);
                if (wait == WAIT_TIMEOUT)
                {
                    result.TimedOut = true;
                    TerminateJobObject(jobHandle, 1460);
                    WaitForSingleObject(process.hProcess, 30000);
                }
                else if (wait != WAIT_OBJECT_0)
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "WaitForSingleObject failed");
                }
                timer.Stop();
                result.ElapsedMilliseconds = timer.ElapsedMilliseconds;
                if (!GetExitCodeProcess(process.hProcess, out uint exitCode))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "GetExitCodeProcess failed");
                result.ExitCode = unchecked((int)exitCode);
                processCompleted = true;

                CloseHandle(process.hProcess); process.hProcess = IntPtr.Zero;
                CloseHandle(jobHandle); jobHandle = IntPtr.Zero;
                result.Stdout = ReadBoundedCapture(stdoutPath, maximumCaptureBytes, out bool stdoutTruncated, out long stdoutTotalBytes);
                result.Stderr = ReadBoundedCapture(stderrPath, maximumCaptureBytes, out bool stderrTruncated, out long stderrTotalBytes);
                result.StdoutTruncated = stdoutTruncated;
                result.StderrTruncated = stderrTruncated;
                result.StdoutTotalBytes = stdoutTotalBytes;
                result.StderrTotalBytes = stderrTotalBytes;
                return result;
            }
            finally
            {
                if (processCreated && !processCompleted)
                {
                    if (jobHandle != IntPtr.Zero && jobHandle != InvalidHandleValue)
                        TerminateJobObject(jobHandle, 1);
                    else if (process.hProcess != IntPtr.Zero && process.hProcess != InvalidHandleValue)
                        TerminateProcess(process.hProcess, 1);
                }
                CloseIfValid(process.hThread);
                CloseIfValid(process.hProcess);
                CloseIfValid(jobHandle);
                CloseIfValid(tokenHandle);
                CloseIfValid(stdoutHandle);
                CloseIfValid(stderrHandle);
                CloseIfValid(stdinHandle);
                if (environmentPointer != IntPtr.Zero) Marshal.FreeHGlobal(environmentPointer);
                if (passwordPointer != IntPtr.Zero) Marshal.ZeroFreeGlobalAllocUnicode(passwordPointer);
                TryDelete(stdoutPath);
                TryDelete(stderrPath);
            }
        }

        private static LaunchResult VerifyToken(IntPtr tokenHandle, string expectedUserSid)
        {
            using (WindowsIdentity identity = new WindowsIdentity(tokenHandle))
            {
                if (identity.User == null || !String.Equals(identity.User.Value, expectedUserSid,
                    StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("The created process token did not match the temporary account SID.");
            }

            bool administratorsEnabled = IsAdministratorsGroupEnabled(tokenHandle);
            int elevatedValue = ReadTokenInt32(tokenHandle, TokenElevation);
            int integrityRid = ReadIntegrityRid(tokenHandle);
            if (administratorsEnabled || elevatedValue != 0 || integrityRid > 0x2000)
                throw new InvalidOperationException("The created process token was not a non-elevated medium-or-lower standard-user token.");

            return new LaunchResult
            {
                UserSidVerified = true,
                AdministratorsGroupEnabled = administratorsEnabled,
                Elevated = elevatedValue != 0,
                IntegrityRid = integrityRid
            };
        }

        private static bool IsAdministratorsGroupEnabled(IntPtr tokenHandle)
        {
            GetTokenInformation(tokenHandle, TokenGroups, IntPtr.Zero, 0, out int length);
            if (length <= 0) throw new Win32Exception(Marshal.GetLastWin32Error(), "Read token groups length failed");
            IntPtr groupsBuffer = Marshal.AllocHGlobal(length);
            SecurityIdentifier sid = new SecurityIdentifier("S-1-5-32-544");
            byte[] bytes = new byte[sid.BinaryLength];
            sid.GetBinaryForm(bytes, 0);
            IntPtr sidPointer = Marshal.AllocHGlobal(bytes.Length);
            try
            {
                Marshal.Copy(bytes, 0, sidPointer, bytes.Length);
                if (!GetTokenInformation(tokenHandle, TokenGroups, groupsBuffer, length, out int _))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Read token groups failed");
                int count = Marshal.ReadInt32(groupsBuffer);
                int offset = IntPtr.Size == 8 ? 8 : 4;
                int itemSize = Marshal.SizeOf<SID_AND_ATTRIBUTES>();
                for (int index = 0; index < count; index++)
                {
                    IntPtr itemPointer = IntPtr.Add(groupsBuffer, offset + checked(index * itemSize));
                    SID_AND_ATTRIBUTES item = Marshal.PtrToStructure<SID_AND_ATTRIBUTES>(itemPointer);
                    if (EqualSid(item.Sid, sidPointer))
                    {
                        bool enabled = (item.Attributes & SE_GROUP_ENABLED) != 0;
                        bool denyOnly = (item.Attributes & SE_GROUP_USE_FOR_DENY_ONLY) != 0;
                        return enabled && !denyOnly;
                    }
                }
                return false;
            }
            finally
            {
                Marshal.FreeHGlobal(sidPointer);
                Marshal.FreeHGlobal(groupsBuffer);
            }
        }

        private static int ReadTokenInt32(IntPtr tokenHandle, int tokenClass)
        {
            IntPtr buffer = Marshal.AllocHGlobal(sizeof(int));
            try
            {
                if (!GetTokenInformation(tokenHandle, tokenClass, buffer, sizeof(int), out int _))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "GetTokenInformation failed");
                return Marshal.ReadInt32(buffer);
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }

        private static int ReadIntegrityRid(IntPtr tokenHandle)
        {
            GetTokenInformation(tokenHandle, TokenIntegrityLevel, IntPtr.Zero, 0, out int length);
            if (length <= 0) throw new Win32Exception(Marshal.GetLastWin32Error(), "Read token integrity length failed");
            IntPtr buffer = Marshal.AllocHGlobal(length);
            try
            {
                if (!GetTokenInformation(tokenHandle, TokenIntegrityLevel, buffer, length, out int _))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Read token integrity failed");
                TOKEN_MANDATORY_LABEL label = Marshal.PtrToStructure<TOKEN_MANDATORY_LABEL>(buffer);
                byte count = Marshal.ReadByte(GetSidSubAuthorityCount(label.Label.Sid));
                if (count == 0) throw new InvalidOperationException("Integrity SID had no sub-authority.");
                return Marshal.ReadInt32(GetSidSubAuthority(label.Label.Sid, (uint)(count - 1)));
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }

        private static void ConfigureKillOnClose(IntPtr jobHandle)
        {
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            int size = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(limits, buffer, false);
                if (!SetInformationJobObject(jobHandle, JobObjectExtendedLimitInformation, buffer, (uint)size))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "SetInformationJobObject failed");
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }

        private static IntPtr BuildEnvironmentBlock(IDictionary<string, string> environment)
        {
            if (environment == null || environment.Count == 0)
                throw new ArgumentException("An explicit environment allowlist is required.");
            StringBuilder block = new StringBuilder();
            foreach (KeyValuePair<string, string> pair in environment.OrderBy(p => p.Key, StringComparer.OrdinalIgnoreCase))
            {
                if (String.IsNullOrEmpty(pair.Key) || pair.Key.Contains("=") || pair.Key.Contains("\0") ||
                    pair.Value == null || pair.Value.Contains("\0"))
                    throw new ArgumentException("The environment block contained an invalid key or value.");
                block.Append(pair.Key).Append('=').Append(pair.Value).Append('\0');
            }
            block.Append('\0');
            return Marshal.StringToHGlobalUni(block.ToString());
        }

        private static string BuildCommandLine(string executable, IEnumerable<string> arguments)
        {
            return String.Join(" ", new[] { QuoteArgument(executable) }.Concat(arguments.Select(QuoteArgument)));
        }

        private static string QuoteArgument(string value)
        {
            if (value == null) throw new ArgumentNullException(nameof(value));
            if (value.Length > 0 && value.All(c => !Char.IsWhiteSpace(c) && c != '"')) return value;
            StringBuilder result = new StringBuilder("\"");
            int backslashes = 0;
            foreach (char character in value)
            {
                if (character == '\\') { backslashes++; continue; }
                if (character == '"')
                {
                    result.Append('\\', backslashes * 2 + 1).Append('"');
                    backslashes = 0;
                    continue;
                }
                result.Append('\\', backslashes).Append(character);
                backslashes = 0;
            }
            result.Append('\\', backslashes * 2).Append('"');
            return result.ToString();
        }

        private static byte[] ReadBoundedCapture(string path, long maximumBytes, out bool truncated, out long totalBytes)
        {
            FileInfo info = new FileInfo(path);
            totalBytes = info.Length;
            truncated = info.Length > maximumBytes;
            int length = checked((int)Math.Min(info.Length, maximumBytes));
            byte[] bytes = new byte[length];
            using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                int offset = 0;
                while (offset < length)
                {
                    int read = stream.Read(bytes, offset, length - offset);
                    if (read == 0) break;
                    offset += read;
                }
                if (offset != length) Array.Resize(ref bytes, offset);
            }
            return bytes;
        }

        private static void ThrowIfInvalidHandle(IntPtr handle, string operation)
        {
            if (handle == IntPtr.Zero || handle == InvalidHandleValue)
                throw new Win32Exception(Marshal.GetLastWin32Error(), operation + " failed");
        }

        private static void CloseIfValid(IntPtr handle)
        {
            if (handle != IntPtr.Zero && handle != InvalidHandleValue) CloseHandle(handle);
        }

        private static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch { }
        }
    }

    public static class LsaRights
    {
        private const uint POLICY_CREATE_ACCOUNT = 0x00000010;
        private const uint POLICY_LOOKUP_NAMES = 0x00000800;
        private const uint STATUS_OBJECT_NAME_NOT_FOUND = 0xC0000034;

        [StructLayout(LayoutKind.Sequential)]
        private struct LSA_OBJECT_ATTRIBUTES
        {
            public uint Length;
            public IntPtr RootDirectory;
            public IntPtr ObjectName;
            public uint Attributes;
            public IntPtr SecurityDescriptor;
            public IntPtr SecurityQualityOfService;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct LSA_UNICODE_STRING
        {
            public ushort Length;
            public ushort MaximumLength;
            public IntPtr Buffer;
        }

        [DllImport("advapi32.dll")]
        private static extern uint LsaOpenPolicy(
            IntPtr SystemName,
            ref LSA_OBJECT_ATTRIBUTES ObjectAttributes,
            uint DesiredAccess,
            out IntPtr PolicyHandle);

        [DllImport("advapi32.dll")]
        private static extern uint LsaAddAccountRights(
            IntPtr PolicyHandle,
            IntPtr AccountSid,
            LSA_UNICODE_STRING[] UserRights,
            uint CountOfRights);

        [DllImport("advapi32.dll")]
        private static extern uint LsaRemoveAccountRights(
            IntPtr PolicyHandle,
            IntPtr AccountSid,
            bool AllRights,
            LSA_UNICODE_STRING[] UserRights,
            uint CountOfRights);

        [DllImport("advapi32.dll")]
        private static extern uint LsaEnumerateAccountRights(
            IntPtr PolicyHandle,
            IntPtr AccountSid,
            out IntPtr UserRights,
            out uint CountOfRights);

        [DllImport("advapi32.dll")]
        private static extern uint LsaClose(IntPtr ObjectHandle);

        [DllImport("advapi32.dll")]
        private static extern uint LsaFreeMemory(IntPtr Buffer);

        [DllImport("advapi32.dll")]
        private static extern uint LsaNtStatusToWinError(uint Status);

        public static void AddAccountRight(string sid, string right)
        {
            WithPolicyAndSid(sid, (policy, sidPointer) =>
            {
                LSA_UNICODE_STRING[] rights = new[] { MakeString(right) };
                try { Check(LsaAddAccountRights(policy, sidPointer, rights, 1), "LsaAddAccountRights"); }
                finally { FreeString(rights[0]); }
            });
        }

        public static bool HasAccountRight(string sid, string right)
        {
            bool found = false;
            WithPolicyAndSid(sid, (policy, sidPointer) =>
            {
                uint status = LsaEnumerateAccountRights(policy, sidPointer, out IntPtr rightsPointer, out uint count);
                if (status == STATUS_OBJECT_NAME_NOT_FOUND) { found = false; return; }
                Check(status, "LsaEnumerateAccountRights");
                try
                {
                    int size = Marshal.SizeOf<LSA_UNICODE_STRING>();
                    for (uint index = 0; index < count; index++)
                    {
                        IntPtr current = IntPtr.Add(rightsPointer, checked((int)index * size));
                        LSA_UNICODE_STRING value = Marshal.PtrToStructure<LSA_UNICODE_STRING>(current);
                        string text = Marshal.PtrToStringUni(value.Buffer, value.Length / 2) ?? String.Empty;
                        if (String.Equals(text, right, StringComparison.OrdinalIgnoreCase)) { found = true; break; }
                    }
                }
                finally { if (rightsPointer != IntPtr.Zero) LsaFreeMemory(rightsPointer); }
            });
            return found;
        }

        public static void RemoveAccountRight(string sid, string right)
        {
            WithPolicyAndSid(sid, (policy, sidPointer) =>
            {
                LSA_UNICODE_STRING[] rights = new[] { MakeString(right) };
                try
                {
                    uint status = LsaRemoveAccountRights(policy, sidPointer, false, rights, 1);
                    if (status != STATUS_OBJECT_NAME_NOT_FOUND) Check(status, "LsaRemoveAccountRights");
                }
                finally { FreeString(rights[0]); }
            });
        }

        private static void WithPolicyAndSid(string sidText, Action<IntPtr, IntPtr> action)
        {
            SecurityIdentifier sid = new SecurityIdentifier(sidText);
            byte[] sidBytes = new byte[sid.BinaryLength];
            sid.GetBinaryForm(sidBytes, 0);
            IntPtr sidPointer = Marshal.AllocHGlobal(sidBytes.Length);
            IntPtr policy = IntPtr.Zero;
            try
            {
                Marshal.Copy(sidBytes, 0, sidPointer, sidBytes.Length);
                LSA_OBJECT_ATTRIBUTES attributes = new LSA_OBJECT_ATTRIBUTES
                {
                    Length = (uint)Marshal.SizeOf<LSA_OBJECT_ATTRIBUTES>()
                };
                Check(LsaOpenPolicy(IntPtr.Zero, ref attributes, POLICY_CREATE_ACCOUNT | POLICY_LOOKUP_NAMES, out policy), "LsaOpenPolicy");
                action(policy, sidPointer);
            }
            finally
            {
                if (policy != IntPtr.Zero) LsaClose(policy);
                Marshal.FreeHGlobal(sidPointer);
            }
        }

        private static LSA_UNICODE_STRING MakeString(string value)
        {
            IntPtr buffer = Marshal.StringToHGlobalUni(value);
            return new LSA_UNICODE_STRING
            {
                Length = checked((ushort)(value.Length * 2)),
                MaximumLength = checked((ushort)((value.Length + 1) * 2)),
                Buffer = buffer
            };
        }

        private static void FreeString(LSA_UNICODE_STRING value)
        {
            if (value.Buffer != IntPtr.Zero) Marshal.FreeHGlobal(value.Buffer);
        }

        private static void Check(uint status, string operation)
        {
            if (status != 0)
                throw new Win32Exception((int)LsaNtStatusToWinError(status), operation + " failed");
        }
    }
}
'@
}

function Get-UpperSha256 {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    return (Get-FileHash -LiteralPath $LiteralPath -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Assert-FullPathUnder {
    param(
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][string]$Parent,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )
    $fullCandidate = [System.IO.Path]::GetFullPath($Candidate)
    $fullParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    if (-not $fullCandidate.StartsWith($fullParent, [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-Evidence $FailureCode
    }
    return $fullCandidate
}

function Protect-AdminOnlyPath {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [switch]$Directory,
        [string]$FailureCode
    )
    $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $systemSid = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-18")
    $administratorsSid = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
    if ($Directory) {
        $security = [System.Security.AccessControl.DirectorySecurity]::new()
        $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
            [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
        $propagation = [System.Security.AccessControl.PropagationFlags]::None
        foreach ($sid in @($currentSid, $systemSid, $administratorsSid)) {
            $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
                $sid,
                [System.Security.AccessControl.FileSystemRights]::FullControl,
                $inheritance,
                $propagation,
                [System.Security.AccessControl.AccessControlType]::Allow
            )
            [void]$security.AddAccessRule($rule)
        }
    }
    else {
        $security = [System.Security.AccessControl.FileSecurity]::new()
        foreach ($sid in @($currentSid, $systemSid, $administratorsSid)) {
            $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
                $sid,
                [System.Security.AccessControl.FileSystemRights]::FullControl,
                [System.Security.AccessControl.AccessControlType]::Allow
            )
            [void]$security.AddAccessRule($rule)
        }
    }
    $security.SetAccessRuleProtection($true, $false)
    try { Set-Acl -LiteralPath $LiteralPath -AclObject $security }
    catch {
        if ($FailureCode -cmatch '^[a-z][a-z0-9_]{0,63}$') { Stop-Evidence $FailureCode }
        if ($Directory) { Stop-Evidence "directory_acl_protection_failed" }
        Stop-Evidence "file_acl_protection_failed"
    }
}

function Assert-AdminOnlyPath {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [switch]$Directory,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )
    try { $security = Get-Acl -LiteralPath $LiteralPath }
    catch { Stop-Evidence $FailureCode }
    if (-not $security.AreAccessRulesProtected) { Stop-Evidence $FailureCode }
    $expectedSids = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    [void]$expectedSids.Add([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
    [void]$expectedSids.Add("S-1-5-18")
    [void]$expectedSids.Add("S-1-5-32-544")
    $rules = @($security.GetAccessRules(
        $true,
        $false,
        [System.Security.Principal.SecurityIdentifier]
    ))
    if ($rules.Count -ne 3) { Stop-Evidence $FailureCode }
    $directoryInheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    foreach ($rule in $rules) {
        $expectedInheritance = if ($Directory) {
            $directoryInheritance
        }
        else { [System.Security.AccessControl.InheritanceFlags]::None }
        if (-not $expectedSids.Remove($rule.IdentityReference.Value) -or
            $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
            $rule.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or
            $rule.InheritanceFlags -ne $expectedInheritance -or
            $rule.PropagationFlags -ne [System.Security.AccessControl.PropagationFlags]::None -or
            $rule.IsInherited) {
            Stop-Evidence $FailureCode
        }
    }
    if ($expectedSids.Count -ne 0) { Stop-Evidence $FailureCode }
}

function Save-CleanupState {
    param([Parameter(Mandatory = $true)][hashtable]$State)
    if ([string]::IsNullOrWhiteSpace($StatePath)) {
        Stop-Evidence "cleanup_state_path_missing"
    }
    $stateParent = Split-Path -Parent $StatePath
    if (-not [System.IO.Directory]::Exists($stateParent)) {
        Stop-Evidence "cleanup_state_parent_missing"
    }
    $stateAlreadyExists = [System.IO.File]::Exists($StatePath)
    if ($stateAlreadyExists) {
        Assert-AdminOnlyPath -LiteralPath $StatePath -FailureCode "cleanup_state_acl_invalid"
    }
    $json = $State | ConvertTo-Json -Depth 5
    try {
        [System.IO.File]::WriteAllText(
            $StatePath,
            $json,
            [System.Text.UTF8Encoding]::new($false, $true)
        )
    }
    catch { Stop-Evidence "cleanup_state_write_failed" }
    if (-not $stateAlreadyExists) {
        Protect-AdminOnlyPath -LiteralPath $StatePath -FailureCode "cleanup_state_acl_protection_failed"
    }
    Assert-AdminOnlyPath -LiteralPath $StatePath -FailureCode "cleanup_state_acl_invalid"
}

function Invoke-CleanupStateSelfTest {
    param([Parameter(Mandatory = $true)][string]$TempRoot)
    $existingStatePath = Get-Variable -Scope Script -Name StatePath -ErrorAction SilentlyContinue
    $previousStatePath = if ($null -ne $existingStatePath) { $existingStatePath.Value } else { $null }
    $selfTestStatePath = Join-Path $TempRoot ("cleanup-state-selftest-" +
        [Guid]::NewGuid().ToString('N') + ".json")
    try {
        $script:StatePath = $selfTestStatePath
        $state = @{
            schemaVersion = 1
            runtimeRoot = "<selftest-runtime>"
            username = ""
            sid = ""
            temporaryUserCreated = $false
            remoteInteractiveDenyApplied = $false
            firewallRules = @()
        }
        Save-CleanupState $state
        $state.remoteInteractiveDenyApplied = $true
        Save-CleanupState $state
        $roundTripped = [System.IO.File]::ReadAllText($selfTestStatePath) | ConvertFrom-Json
        if (-not $roundTripped.remoteInteractiveDenyApplied) {
            Stop-Evidence "cleanup_state_selftest_roundtrip_failed"
        }
        Assert-AdminOnlyPath -LiteralPath $selfTestStatePath `
            -FailureCode "cleanup_state_selftest_acl_invalid"
        return [ordered]@{ passed = $true; repeatedWriteVerified = $true; aclVerified = $true }
    }
    finally {
        if ([System.IO.File]::Exists($selfTestStatePath)) {
            [System.IO.File]::Delete($selfTestStatePath)
        }
        if ($null -ne $existingStatePath) { $script:StatePath = $previousStatePath }
        else { Remove-Variable -Scope Script -Name StatePath -ErrorAction SilentlyContinue }
    }
}

function Assert-Bundle {
    param([Parameter(Mandatory = $true)][string]$Root)
    if (-not [System.IO.Path]::IsPathFullyQualified($Root) -or -not [System.IO.Directory]::Exists($Root)) {
        Stop-Evidence "bundle_root_invalid"
    }
    if ($ExpectedArtifactId -notmatch '^[1-9][0-9]*$' -or
        $ExpectedSourceSha -notmatch '^[0-9a-fA-F]{40}$' -or
        $ExpectedManifestSha -notmatch '^[0-9a-fA-F]{64}$' -or
        $ExpectedArtifactDigest -notmatch '^(?i:sha256:)?[0-9a-f]{64}$') {
        Stop-Evidence "bundle_identity_invalid"
    }

    $expectedNames = @("bundle-manifest.json", "m0c_conversion_evidence.ps1", "m0_proteowizard_spike.exe")
    $actualFiles = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force)
    $actualNames = @($actualFiles | ForEach-Object {
        [System.IO.Path]::GetRelativePath($Root, $_.FullName).Replace('\', '/')
    } | Sort-Object)
    if (Compare-Object -ReferenceObject ($expectedNames | Sort-Object) -DifferenceObject $actualNames) {
        Stop-Evidence "bundle_allowlist_mismatch"
    }
    if (Get-ChildItem -LiteralPath $Root -Recurse -Directory -Force | Select-Object -First 1) {
        Stop-Evidence "bundle_subdirectory_present"
    }
    if (Get-ChildItem -LiteralPath $Root -Force | Where-Object {
        ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
    } | Select-Object -First 1) {
        Stop-Evidence "bundle_reparse_point_present"
    }

    $manifestPath = Join-Path $Root "bundle-manifest.json"
    if ((Get-UpperSha256 $manifestPath) -ne $ExpectedManifestSha.ToUpperInvariant()) {
        Stop-Evidence "bundle_manifest_hash_mismatch"
    }
    try {
        $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    }
    catch {
        Stop-Evidence "bundle_manifest_invalid"
    }
    if ($manifest.schemaVersion -ne 1 -or $manifest.sourceSha -ne $ExpectedSourceSha) {
        Stop-Evidence "bundle_manifest_identity_mismatch"
    }
    $payloadNames = @($manifest.files | ForEach-Object { [string]$_.path } | Sort-Object)
    $expectedPayloadNames = @("m0c_conversion_evidence.ps1", "m0_proteowizard_spike.exe")
    if (Compare-Object -ReferenceObject $expectedPayloadNames -DifferenceObject $payloadNames) {
        Stop-Evidence "bundle_manifest_allowlist_mismatch"
    }
    foreach ($entry in $manifest.files) {
        $name = [string]$entry.path
        if ($name -notin $expectedPayloadNames) {
            Stop-Evidence "bundle_manifest_path_invalid"
        }
        $path = Join-Path $Root $name
        $item = Get-Item -LiteralPath $path
        if ([int64]$entry.bytes -ne [int64]$item.Length -or
            (Get-UpperSha256 $path) -ne ([string]$entry.sha256).ToUpperInvariant()) {
            Stop-Evidence "bundle_payload_mismatch"
        }
    }
}

function Invoke-ExactDownload {
    param(
        [Parameter(Mandatory = $true)][uri]$Uri,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][int64]$ExpectedBytes,
        [Parameter(Mandatory = $true)][string]$ExpectedSha,
        [Parameter(Mandatory = $true)][string]$FailurePrefix
    )
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromMinutes(12)
    try {
        $response = $client.GetAsync($Uri, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        try {
            if ($response.StatusCode -ne [System.Net.HttpStatusCode]::OK) {
                Stop-Evidence "${FailurePrefix}_http_status"
            }
            if ($null -ne $response.Content.Headers.ContentLength -and
                [int64]$response.Content.Headers.ContentLength -ne $ExpectedBytes) {
                Stop-Evidence "${FailurePrefix}_content_length_mismatch"
            }
            $source = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
            try {
                $target = [System.IO.FileStream]::new(
                    $Destination,
                    [System.IO.FileMode]::CreateNew,
                    [System.IO.FileAccess]::Write,
                    [System.IO.FileShare]::None
                )
                try { $source.CopyTo($target) }
                finally { $target.Dispose() }
            }
            finally { $source.Dispose() }
        }
        finally { $response.Dispose() }
    }
    finally {
        $client.Dispose()
        $handler.Dispose()
    }
    $item = Get-Item -LiteralPath $Destination
    if ([int64]$item.Length -ne $ExpectedBytes -or
        (Get-UpperSha256 $Destination) -ne $ExpectedSha.ToUpperInvariant()) {
        Stop-Evidence "${FailurePrefix}_identity_mismatch"
    }
}

function Test-WindowsArchiveSegment {
    param([Parameter(Mandatory = $true)][string]$Segment)
    if ([string]::IsNullOrWhiteSpace($Segment) -or $Segment -in @('.', '..') -or
        $Segment.IndexOfAny([char[]]'<>:"|?*') -ge 0 -or
        $Segment.EndsWith('.') -or $Segment.EndsWith(' ')) {
        return $false
    }
    $baseName = $Segment.Split('.')[0]
    if ($baseName -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$') {
        return $false
    }
    return $true
}

function Get-ValidatedArchiveMemberKey {
    param(
        [Parameter(Mandatory = $true)][string]$Portable,
        [Parameter(Mandatory = $true)][string]$ToolsDirectory
    )
    if ($Portable.StartsWith('./', [System.StringComparison]::Ordinal)) {
        $Portable = $Portable.Substring(2)
    }
    if ($Portable.StartsWith('/') -or $Portable.StartsWith('//') -or
        $Portable -match '^[A-Za-z]:' -or $Portable.Contains('//')) {
        Stop-Evidence "archive_member_rooted"
    }
    $trimmed = $Portable.TrimEnd('/')
    $segments = @($trimmed.Split('/'))
    $invalidSegments = @($segments | Where-Object { -not (Test-WindowsArchiveSegment $_) })
    if ($segments.Count -eq 0 -or $invalidSegments.Count -ne 0) {
        Stop-Evidence "archive_member_path_invalid"
    }
    $key = [string]::Join('/', $segments)
    $prospective = Join-Path $ToolsDirectory ($key.Replace('/', '\'))
    if ($prospective.Length -gt 240) {
        Stop-Evidence "archive_member_path_too_long"
    }
    return $key
}

function Expand-VerifiedArchive {
    param(
        [Parameter(Mandatory = $true)][string]$ArchivePath,
        [Parameter(Mandatory = $true)][string]$ToolsDirectory
    )
    $tar = Join-Path $env:SystemRoot "System32\tar.exe"
    if (-not [System.IO.File]::Exists($tar)) {
        Stop-Evidence "archive_tool_missing"
    }
    Write-Stage "archive_member_listing"
    $memberOutput = @(& $tar -tf $ArchivePath 2>&1)
    if ($LASTEXITCODE -ne 0 -or $memberOutput.Count -ne $ExpectedArchiveMembers) {
        Stop-Evidence "archive_listing_invalid"
    }
    $verboseOutput = @(& $tar -tvf $ArchivePath 2>&1)
    if ($LASTEXITCODE -ne 0 -or $verboseOutput.Count -ne $memberOutput.Count) {
        Stop-Evidence "archive_type_listing_invalid"
    }

    Write-Stage "archive_member_validation"
    $normalized = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    for ($index = 0; $index -lt $memberOutput.Count; $index++) {
        $member = [string]$memberOutput[$index]
        $typeLine = [string]$verboseOutput[$index]
        if ([string]::IsNullOrEmpty($typeLine) -or $typeLine[0] -notin @('-', 'd')) {
            Stop-Evidence "archive_special_entry"
        }
        if ($member -match '[\x00-\x1f\x7f]' -or $member -match '[^\x20-\x7e]') {
            Stop-Evidence "archive_member_encoding_invalid"
        }
        $portable = $member.Replace('\', '/')
        if ($portable -in @('.', './')) {
            if ($typeLine[0] -ne 'd' -or -not $normalized.Add('<archive-root>')) {
                Stop-Evidence "archive_root_entry_invalid"
            }
            continue
        }
        $key = Get-ValidatedArchiveMemberKey -Portable $portable -ToolsDirectory $ToolsDirectory
        if (-not $normalized.Add($key)) {
            Stop-Evidence "archive_duplicate_member"
        }
    }

    Write-Stage "archive_payload_extraction"
    $extractOutput = @(& $tar -xf $ArchivePath -C $ToolsDirectory 2>&1)
    if ($LASTEXITCODE -ne 0 -or $extractOutput.Count -ne 0) {
        Stop-Evidence "archive_extraction_failed"
    }
    Write-Stage "archive_inventory_validation"
    $toolsFull = [System.IO.Path]::GetFullPath($ToolsDirectory).TrimEnd('\') + '\'
    $items = @(Get-ChildItem -LiteralPath $ToolsDirectory -Recurse -Force)
    if ($items.Count -ne $ExpectedExtractedItems) {
        Stop-Evidence "archive_extracted_inventory_mismatch"
    }
    foreach ($item in $items) {
        $full = [System.IO.Path]::GetFullPath($item.FullName)
        if (-not $full.StartsWith($toolsFull, [System.StringComparison]::OrdinalIgnoreCase) -or
            ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            Stop-Evidence "archive_extraction_containment_failed"
        }
        if (-not $item.PSIsContainer) {
            $streams = @(Get-Item -LiteralPath $item.FullName -Stream * -ErrorAction Stop)
            if ($streams | Where-Object { $_.Stream -notin @(':$DATA', '::$DATA') }) {
                Stop-Evidence "archive_alternate_data_stream_present"
            }
        }
    }

    Write-Stage "archive_executable_identity"
    $msconvert = @(Get-ChildItem -LiteralPath $ToolsDirectory -Recurse -File -Filter "msconvert.exe")
    $msaccess = @(Get-ChildItem -LiteralPath $ToolsDirectory -Recurse -File -Filter "msaccess.exe")
    if ($msconvert.Count -ne 1 -or $msaccess.Count -ne 1) {
        Stop-Evidence "archive_target_count_mismatch"
    }
    if ((Get-UpperSha256 $msconvert[0].FullName) -ne $MsConvertSha256 -or
        (Get-UpperSha256 $msaccess[0].FullName) -ne $MsAccessSha256) {
        Stop-Evidence "archive_executable_hash_mismatch"
    }
    return [ordered]@{
        msconvert = $msconvert[0].FullName
        msaccess = $msaccess[0].FullName
        portableRoot = $msconvert[0].DirectoryName
    }
}

function New-RandomSecurePassword {
    $characters = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%+-_'
    $required = [char[]]'Aa7!'
    $buffer = [char[]]::new(32)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        for ($index = 0; $index -lt $required.Length; $index++) {
            $buffer[$index] = $required[$index]
        }
        $random = [byte[]]::new(4)
        for ($index = $required.Length; $index -lt $buffer.Length; $index++) {
            $rng.GetBytes($random)
            $value = [BitConverter]::ToUInt32($random, 0)
            $buffer[$index] = $characters[$value % $characters.Length]
        }
        for ($index = $buffer.Length - 1; $index -gt 0; $index--) {
            $rng.GetBytes($random)
            $swap = [BitConverter]::ToUInt32($random, 0) % ($index + 1)
            $temporary = $buffer[$index]
            $buffer[$index] = $buffer[$swap]
            $buffer[$swap] = $temporary
        }
        $secure = [System.Security.SecureString]::new()
        foreach ($character in $buffer) { $secure.AppendChar($character) }
        $secure.MakeReadOnly()
        return $secure
    }
    finally {
        [Array]::Clear($buffer, 0, $buffer.Length)
        $rng.Dispose()
    }
}

function New-RuntimeAccount {
    param(
        [Parameter(Mandatory = $true)][hashtable]$State,
        [Parameter(Mandatory = $true)][System.Security.SecureString]$Password
    )
    $nonce = [Guid]::NewGuid().ToString('N').Substring(0, 10)
    $name = "m0b_$nonce"
    $State.username = $name
    Save-CleanupState $State
    if (Get-LocalUser -Name $name -ErrorAction SilentlyContinue) {
        Stop-Evidence "temporary_account_collision"
    }
    $account = New-LocalUser -Name $name -Password $Password -AccountNeverExpires `
        -PasswordNeverExpires -UserMayNotChangePassword `
        -Description "Disposable MSCanvas M0C evidence account"
    $sid = $account.SID.Value
    if ([string]::IsNullOrWhiteSpace($sid)) {
        Stop-Evidence "temporary_account_sid_missing"
    }
    $State.sid = $sid
    $State.temporaryUserCreated = $true
    Save-CleanupState $State

    foreach ($wellKnownGroupSid in @("S-1-5-32-544", "S-1-5-32-555")) {
        $group = Get-LocalGroup -SID ([System.Security.Principal.SecurityIdentifier]::new($wellKnownGroupSid))
        $member = Get-LocalGroupMember -Group $group -ErrorAction Stop | Where-Object {
            $null -ne $_.SID -and $_.SID.Value -eq $sid
        }
        if ($member) {
            Stop-Evidence "temporary_account_privileged_group"
        }
    }

    $State.remoteInteractiveDenyApplied = $true
    Save-CleanupState $State
    [MSCanvas.M0Evidence.LsaRights]::AddAccountRight($sid, $RemoteInteractiveDenyRight)
    if (-not [MSCanvas.M0Evidence.LsaRights]::HasAccountRight($sid, $RemoteInteractiveDenyRight)) {
        Stop-Evidence "temporary_account_remote_deny_unverified"
    }
    return [ordered]@{ name = $name; sid = $sid }
}

function Set-RuntimeDirectoryAcl {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][string]$TemporarySid,
        [Parameter(Mandatory = $true)][System.Security.AccessControl.FileSystemRights]$TemporaryRights
    )
    $security = [System.Security.AccessControl.DirectorySecurity]::new()
    $security.SetAccessRuleProtection($true, $false)
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $propagation = [System.Security.AccessControl.PropagationFlags]::None
    $fullControlSids = @(
        [System.Security.Principal.WindowsIdentity]::GetCurrent().User,
        [System.Security.Principal.SecurityIdentifier]::new("S-1-5-18"),
        [System.Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
    )
    foreach ($sid in $fullControlSids) {
        $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            $sid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            $propagation,
            [System.Security.AccessControl.AccessControlType]::Allow
        )) | Out-Null
    }
    $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        [System.Security.Principal.SecurityIdentifier]::new($TemporarySid),
        $TemporaryRights,
        $inheritance,
        $propagation,
        [System.Security.AccessControl.AccessControlType]::Allow
    )) | Out-Null
    Set-Acl -LiteralPath $LiteralPath -AclObject $security
}

function Assert-RuntimeDirectoryAcl {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][string]$TemporarySid,
        [Parameter(Mandatory = $true)][ValidateSet("Read", "Write")][string]$AccessClass
    )
    $acl = Get-Acl -LiteralPath $LiteralPath
    if (-not $acl.AreAccessRulesProtected) {
        Stop-Evidence "runtime_acl_inheritance_enabled"
    }
    $broadSids = @("S-1-1-0", "S-1-5-11", "S-1-5-32-545")
    foreach ($rule in $acl.Access) {
        $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
        if ($sid -in $broadSids) {
            Stop-Evidence "runtime_acl_broad_principal"
        }
    }
    $temporaryRules = @($acl.Access | Where-Object {
        $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
        $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $TemporarySid
    })
    if ($temporaryRules.Count -eq 0) {
        Stop-Evidence "runtime_acl_temporary_principal_missing"
    }
    $combined = [System.Security.AccessControl.FileSystemRights]0
    foreach ($rule in $temporaryRules) { $combined = $combined -bor $rule.FileSystemRights }
    $writeMask = [System.Security.AccessControl.FileSystemRights]::WriteData -bor
        [System.Security.AccessControl.FileSystemRights]::AppendData -bor
        [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::Delete -bor
        [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [System.Security.AccessControl.FileSystemRights]::TakeOwnership
    if ($AccessClass -eq "Read") {
        if (($combined -band [System.Security.AccessControl.FileSystemRights]::ReadAndExecute) -ne
            [System.Security.AccessControl.FileSystemRights]::ReadAndExecute -or
            ($combined -band $writeMask) -ne 0) {
            Stop-Evidence "runtime_acl_readonly_invalid"
        }
    }
    elseif (($combined -band [System.Security.AccessControl.FileSystemRights]::Modify) -ne
        [System.Security.AccessControl.FileSystemRights]::Modify) {
        Stop-Evidence "runtime_acl_writable_invalid"
    }
}

function Assert-ReadonlyTreeAcl {
    param(
        [Parameter(Mandatory = $true)][string[]]$Roots,
        [Parameter(Mandatory = $true)][string]$TemporarySid
    )
    $broadSids = @("S-1-1-0", "S-1-5-11", "S-1-5-32-545")
    $writeMask = [System.Security.AccessControl.FileSystemRights]::WriteData -bor
        [System.Security.AccessControl.FileSystemRights]::AppendData -bor
        [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [System.Security.AccessControl.FileSystemRights]::Delete -bor
        [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [System.Security.AccessControl.FileSystemRights]::TakeOwnership
    $audited = 0
    foreach ($root in $Roots) {
        $items = @(Get-Item -LiteralPath $root)
        $items += @(Get-ChildItem -LiteralPath $root -Recurse -Force)
        foreach ($item in $items) {
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                Stop-Evidence "readonly_tree_reparse_point"
            }
            $acl = Get-Acl -LiteralPath $item.FullName
            $combined = [System.Security.AccessControl.FileSystemRights]0
            foreach ($rule in $acl.Access) {
                $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
                if ($sid -in $broadSids) { Stop-Evidence "readonly_tree_broad_principal" }
                if ($sid -eq $TemporarySid -and
                    $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow) {
                    $combined = $combined -bor $rule.FileSystemRights
                }
            }
            if (($combined -band [System.Security.AccessControl.FileSystemRights]::ReadAndExecute) -ne
                [System.Security.AccessControl.FileSystemRights]::ReadAndExecute -or
                ($combined -band $writeMask) -ne 0) {
                Stop-Evidence "readonly_tree_acl_invalid"
            }
            $audited++
        }
    }
    return $audited
}

function Set-AndVerifyRuntimeAcls {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Layout,
        [Parameter(Mandatory = $true)][string]$TemporarySid
    )
    Set-RuntimeDirectoryAcl -LiteralPath $Layout.root -TemporarySid $TemporarySid `
        -TemporaryRights ([System.Security.AccessControl.FileSystemRights]::ReadAndExecute)
    Assert-RuntimeDirectoryAcl -LiteralPath $Layout.root -TemporarySid $TemporarySid -AccessClass Read
    foreach ($name in @("tools", "harness", "fixture")) {
        Set-RuntimeDirectoryAcl -LiteralPath $Layout[$name] -TemporarySid $TemporarySid `
            -TemporaryRights ([System.Security.AccessControl.FileSystemRights]::ReadAndExecute)
        Assert-RuntimeDirectoryAcl -LiteralPath $Layout[$name] -TemporarySid $TemporarySid -AccessClass Read
    }
    foreach ($name in @("output", "evidence", "temp")) {
        Set-RuntimeDirectoryAcl -LiteralPath $Layout[$name] -TemporarySid $TemporarySid `
            -TemporaryRights ([System.Security.AccessControl.FileSystemRights]::Modify)
        Assert-RuntimeDirectoryAcl -LiteralPath $Layout[$name] -TemporarySid $TemporarySid -AccessClass Write
    }
    return Assert-ReadonlyTreeAcl -Roots @($Layout.tools, $Layout.harness, $Layout.fixture) `
        -TemporarySid $TemporarySid
}

function Assert-FirewallRuleProjection {
    param(
        [Parameter(Mandatory = $true)][object[]]$Rules,
        [Parameter(Mandatory = $true)][object[]]$Applications,
        [Parameter(Mandatory = $true)][string]$ExpectedName,
        [Parameter(Mandatory = $true)][string]$ExpectedProgramPath,
        [Parameter(Mandatory = $true)][AllowNull()][object]$RawEnforcementProperty
    )
    if ($Rules.Count -ne 1) { Stop-Evidence "firewall_rule_count_invalid" }
    $rule = $Rules[0]
    if ([string]$rule.Name -cne $ExpectedName -or
        [string]$rule.DisplayName -cne "MSCanvas disposable M0C outbound block") {
        Stop-Evidence "firewall_rule_identity_invalid"
    }
    if ([string]$rule.Direction -cne "Outbound") {
        Stop-Evidence "firewall_rule_direction_invalid"
    }
    if ([string]$rule.Action -cne "Block") {
        Stop-Evidence "firewall_rule_action_invalid"
    }
    if ([string]$rule.Enabled -cne "True") {
        Stop-Evidence "firewall_rule_disabled"
    }
    if ([string]$rule.Profile -cne "Any") {
        Stop-Evidence "firewall_rule_profile_invalid"
    }
    if ([string]$rule.PrimaryStatus -cne "OK") {
        Stop-Evidence "firewall_rule_primary_status_invalid"
    }
    # The localized NetSecurity projection renames enforcement states. Inspect
    # the underlying locale-independent UInt16 CIM array instead: 1 is fully
    # enforced and 5 means the rule's profile is inactive. Profile Any can
    # legitimately include inactive-profile entries, but no other reason is
    # acceptable and at least one active enforcement is required.
    $enforcementProperty = $RawEnforcementProperty
    if ($null -eq $enforcementProperty -or
        [string]$enforcementProperty.CimType -cne "UInt16Array") {
        Stop-Evidence "firewall_rule_enforcement_status_shape_invalid"
    }
    $enforcementStatuses = @($enforcementProperty.Value)
    if ($enforcementStatuses.Count -eq 0) {
        Stop-Evidence "firewall_rule_enforcement_status_missing"
    }
    $enforcedCount = 0
    foreach ($status in $enforcementStatuses) {
        if ($status -isnot [uint16]) {
            Stop-Evidence "firewall_rule_enforcement_status_shape_invalid"
        }
        switch ([uint16]$status) {
            1 { $enforcedCount++; continue }
            5 { continue }
            default { Stop-Evidence "firewall_rule_blocking_reason_present" }
        }
    }
    if ($enforcedCount -eq 0) {
        Stop-Evidence "firewall_rule_no_active_enforcement"
    }
    if ($Applications.Count -ne 1) {
        Stop-Evidence "firewall_application_filter_count_invalid"
    }
    if (-not [string]::Equals(
            [string]$Applications[0].Program,
            $ExpectedProgramPath,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
        Stop-Evidence "firewall_rule_program_path_invalid"
    }
}

function Add-VerifiedFirewallRule {
    param(
        [Parameter(Mandatory = $true)][string]$RuleName,
        [Parameter(Mandatory = $true)][string]$ProgramPath,
        [Parameter(Mandatory = $true)][hashtable]$State
    )
    if (-not [System.IO.Path]::IsPathFullyQualified($ProgramPath) -or
        -not [System.IO.File]::Exists($ProgramPath)) {
        Stop-Evidence "firewall_program_path_invalid"
    }
    if (Get-NetFirewallRule -Name $RuleName -PolicyStore ActiveStore -ErrorAction SilentlyContinue) {
        Stop-Evidence "firewall_rule_collision"
    }
    $State.firewallRules = @($State.firewallRules) + $RuleName
    Save-CleanupState $State
    New-NetFirewallRule -Name $RuleName -DisplayName "MSCanvas disposable M0C outbound block" `
        -Direction Outbound -Action Block -Program $ProgramPath -Profile Any -Enabled True `
        -PolicyStore ActiveStore | Out-Null
    $rules = @(Get-NetFirewallRule -Name $RuleName -PolicyStore ActiveStore -ErrorAction Stop)
    $applications = @($rules | Get-NetFirewallApplicationFilter)
    $rawEnforcementProperty = if ($rules.Count -eq 1) {
        $rules[0].PSBase.CimInstanceProperties['EnforcementStatus']
    }
    else { $null }
    Assert-FirewallRuleProjection -Rules $rules -Applications $applications `
        -ExpectedName $RuleName -ExpectedProgramPath $ProgramPath `
        -RawEnforcementProperty $rawEnforcementProperty
}

function Assert-FirewallEnforcement {
    $service = Get-Service -Name "MpsSvc" -ErrorAction Stop
    if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Running) {
        Stop-Evidence "firewall_service_not_running"
    }
    $connectionProfiles = @(Get-NetConnectionProfile -ErrorAction Stop)
    if ($connectionProfiles.Count -eq 0) {
        Stop-Evidence "active_network_profile_unavailable"
    }
    $profileNames = @($connectionProfiles | ForEach-Object {
        switch ([string]$_.NetworkCategory) {
            "Public" { "Public" }
            "Private" { "Private" }
            "DomainAuthenticated" { "Domain" }
            default { Stop-Evidence "active_network_profile_unknown" }
        }
    } | Sort-Object -Unique)
    foreach ($name in $profileNames) {
        $profile = Get-NetFirewallProfile -Name $name -PolicyStore ActiveStore -ErrorAction Stop
        if ([string]$profile.Enabled -ne "True") { Stop-Evidence "active_firewall_profile_disabled" }
    }
    return $profileNames
}

function New-MinimalEnvironment {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Layout,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Account,
        [Parameter(Mandatory = $true)][string]$PortableRoot
    )
    $windowsRoot = [System.IO.Path]::GetFullPath($env:SystemRoot)
    $system32 = Join-Path $windowsRoot "System32"
    $path = [string]::Join(';', @($PortableRoot, $system32, $windowsRoot))
    $environment = [System.Collections.Generic.Dictionary[string, string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    $environment.Add("SystemRoot", $windowsRoot)
    $environment.Add("WINDIR", $windowsRoot)
    $environment.Add("TEMP", $Layout.temp)
    $environment.Add("TMP", $Layout.temp)
    $environment.Add("PATH", $path)
    return $environment
}

function Invoke-SecureProcess {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Account,
        [Parameter(Mandatory = $true)][System.Security.SecureString]$Password,
        [Parameter(Mandatory = $true)][string]$Application,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][System.Collections.Generic.IDictionary[string, string]]$Environment,
        [Parameter(Mandatory = $true)][hashtable]$Layout,
        [int]$TimeoutMilliseconds = 600000
    )
    try {
        return [MSCanvas.M0Evidence.SecureLauncher]::Run(
            $Account.name,
            $Password,
            $Account.sid,
            $Application,
            $Arguments,
            $Environment,
            $Layout.root,
            $Layout.temp,
            $TimeoutMilliseconds,
            $MaximumCaptureBytes
        )
    }
    catch {
        Stop-Evidence "standard_user_process_creation_failed"
    }
}

function Get-Sha256OfBytes {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToHexString($sha.ComputeHash($Bytes)) }
    finally { $sha.Dispose() }
}

function Get-Utf8Text {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][byte[]]$Bytes)
    return [System.Text.Encoding]::UTF8.GetString($Bytes)
}

function ConvertFrom-HarnessFacts {
    param([Parameter(Mandatory = $true)][string]$Text)
    $facts = [ordered]@{}
    $allowed = @(
        '^runtime_proof\.',
        '^discovery\.(availability|source|same_installation|release|build_date)$',
        '^discovery\.(msconvert|msaccess)\.(exists|reported_release|release|source_revision|build_date|probe\.(exit_code|elapsed_ms|stdout_captured_bytes|stderr_captured_bytes|stdout_total_bytes|stderr_total_bytes|stdout_truncated|stderr_truncated))$',
        '^command_surface\.(tool|validated_from_installed_help|help\.(stdout_sha256|stderr_sha256)|tic_capability)$',
        '^command\.(tool|argv_count)$',
        '^command\.argv\[(?:[0-9]|[12][0-9]|3[01])\]$',
        '^process\.(exit_code|termination|elapsed_ms|parser_elapsed_ms|peak_job_memory_bytes|stdout_captured_bytes|stderr_captured_bytes|stdout_total_bytes|stderr_total_bytes|stdout_truncated|stderr_truncated|max_active_processes|final_active_processes|output_directory_changed|partial_output_present)$',
        '^failure\.(kind|retryability|partial_output_present)$',
        '^conversion_output\.(bytes|sha256|root|spectrum_count|chromatogram_count)$',
        '^conversion_source\.(facts|reason|bytes|sha256|spectrum_count|chromatogram_count)$',
        '^conversion_integrity\.(comparison|outcome|fully_verified|verified|unverified|advisory)$',
        '^preview\.(interpretation|result_kind|error_kind|malformed_kind|requested_index)$',
        '^preview\.(metadata|run_summary|spectrum_table|tic|selected_spectrum)\.[a-z_]+$',
        '^inspect\.[a-z0-9_.]+$'
    )
    foreach ($line in ($Text -split "`r?`n")) {
        if ($line -notmatch '^([A-Za-z0-9_.\[\]-]+)=([^\r\n]{0,300})$') { continue }
        $key = $Matches[1]
        $value = $Matches[2]
        if ($allowed | Where-Object { $key -match $_ }) {
            if ($value -match '(?i)(?<![A-Za-z0-9])[A-Z]:[\\/]' -or $value -match '^\\\\') {
                continue
            }
            $facts[$key] = $value
        }
    }
    return $facts
}

function Get-OutputInventory {
    param([Parameter(Mandatory = $true)][string]$Directory)
    $items = @(Get-ChildItem -LiteralPath $Directory -Recurse -Force)
    $files = @()
    $partial = $false
    foreach ($item in $items) {
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            Stop-Evidence "operation_output_reparse_point"
        }
        if ($item.PSIsContainer) { continue }
        $streams = @(Get-Item -LiteralPath $item.FullName -Stream * -ErrorAction Stop)
        if ($streams | Where-Object { $_.Stream -notin @(':$DATA', '::$DATA') }) {
            Stop-Evidence "operation_output_alternate_stream"
        }
        $extension = [System.IO.Path]::GetExtension($item.Name)
        if ($extension -match '^(?i:\.part|\.partial|\.tmp)$') { $partial = $true }
        $files += [ordered]@{
            alias = "<output-file:$($files.Count + 1)>"
            extension = $extension
            bytes = [int64]$item.Length
            sha256 = Get-UpperSha256 $item.FullName
        }
    }
    return [ordered]@{
        itemCount = $items.Count
        fileCount = $files.Count
        partialFilePresent = $partial
        files = @($files)
    }
}

function ConvertTo-SanitizedScientificLine {
    param([Parameter(Mandatory = $true)][string]$Line)
    $value = $Line -replace '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', ' '
    if (Get-Variable -Scope Script -Name RuntimeAliases -ErrorAction SilentlyContinue) {
        foreach ($entry in $script:RuntimeAliases) {
            foreach ($variant in @(
                [string]$entry.value,
                ([string]$entry.value).Replace('\', '/'),
                ([string]$entry.value).Replace('/', '\')
            ) | Select-Object -Unique) {
                if (-not [string]::IsNullOrWhiteSpace($variant)) {
                    $value = [regex]::Replace(
                        $value,
                        [regex]::Escape($variant),
                        [string]$entry.alias,
                        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
                    )
                }
            }
        }
    }
    if ($value -match '(?i)(?<![A-Za-z0-9])[A-Z]:[\\/]' -or
        $value -match '(?i)file:(?:[\\/]|\\[\\/])+' -or $value -match '\\\\' -or
        $value -match '(?i)GITHUB_|ACTIONS_|github_pat_|gh[opsu]_|bearer\s+|authorization\s*[:=]|password\s*[:=]|credential\s*[:=]') {
        return $null
    }
    $value = ($value -replace '\s+', ' ').Trim()
    if ($value.Length -gt 400) { $value = $value.Substring(0, 400) + "...<bounded>" }
    return $value
}

function Get-XmlStructure {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    $settings = [System.Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $settings.MaxCharactersFromEntities = 0
    $settings.MaxCharactersInDocument = 8GB
    $settings.IgnoreComments = $true
    $settings.IgnoreProcessingInstructions = $true
    $reader = [System.Xml.XmlReader]::Create($LiteralPath, $settings)
    try {
        $root = $null
        $spectra = 0
        $chromatograms = 0
        $binaryArrayCount = 0
        $zlibBinaryArrayCount = 0
        $mzMlBinaryArrayDepth = -1
        $mzMlBinaryArrayZlib = $false
        $profileTermCount = 0
        $centroidTermCount = 0
        $mzXmlProfileScanCount = 0
        $mzXmlCentroidScanCount = 0
        $mzXmlUnknownRepresentationScanCount = 0
        $precision32 = $false
        $precision64 = $false
        while ($reader.Read()) {
            if ($reader.NodeType -eq [System.Xml.XmlNodeType]::EndElement -and
                $reader.LocalName -eq "binaryDataArray" -and
                $reader.Depth -eq $mzMlBinaryArrayDepth) {
                if ($mzMlBinaryArrayZlib) { $zlibBinaryArrayCount++ }
                $mzMlBinaryArrayDepth = -1
                $mzMlBinaryArrayZlib = $false
                continue
            }
            if ($reader.NodeType -ne [System.Xml.XmlNodeType]::Element) { continue }
            if ($null -eq $root) { $root = $reader.LocalName }
            switch ($reader.LocalName) {
                "spectrum" {
                    if ($root -in @("mzML", "indexedmzML")) { $spectra++ }
                }
                "scan" {
                    if ($root -eq "mzXML") {
                        $spectra++
                        switch ($reader.GetAttribute("centroided")) {
                            "1" { $mzXmlCentroidScanCount++ }
                            "0" { $mzXmlProfileScanCount++ }
                            default { $mzXmlUnknownRepresentationScanCount++ }
                        }
                    }
                }
                "chromatogram" {
                    if ($root -in @("mzML", "indexedmzML")) { $chromatograms++ }
                }
                "binaryDataArray" {
                    if ($root -in @("mzML", "indexedmzML")) {
                        $binaryArrayCount++
                        if (-not $reader.IsEmptyElement) {
                            if ($mzMlBinaryArrayDepth -ge 0) { Stop-Evidence "nested_binary_data_array_invalid" }
                            $mzMlBinaryArrayDepth = $reader.Depth
                            $mzMlBinaryArrayZlib = $false
                        }
                    }
                }
                "cvParam" {
                    $accession = $reader.GetAttribute("accession")
                    $name = $reader.GetAttribute("name")
                    if ($mzMlBinaryArrayDepth -ge 0 -and
                        ($accession -eq "MS:1000574" -or $name -match '^(?i:zlib compression)$')) {
                        $mzMlBinaryArrayZlib = $true
                    }
                    if ($accession -eq "MS:1000128" -or $name -match '^(?i:profile spectrum)$') {
                        $profileTermCount++
                    }
                    if ($accession -eq "MS:1000127" -or $name -match '^(?i:centroid spectrum)$') {
                        $centroidTermCount++
                    }
                    if ($accession -eq "MS:1000521" -or $name -match '^(?i:32-bit float)$') { $precision32 = $true }
                    if ($accession -eq "MS:1000523" -or $name -match '^(?i:64-bit float)$') { $precision64 = $true }
                }
                "peaks" {
                    if ($root -eq "mzXML") {
                        $binaryArrayCount++
                        if ($reader.GetAttribute("compressionType") -match '^(?i:zlib)$') {
                            $zlibBinaryArrayCount++
                        }
                        if ($reader.GetAttribute("precision") -eq "32") { $precision32 = $true }
                        if ($reader.GetAttribute("precision") -eq "64") { $precision64 = $true }
                    }
                }
            }
        }
        return [ordered]@{
            root = $root
            spectrumCount = $spectra
            chromatogramCount = $chromatograms
            binaryArrayCount = $binaryArrayCount
            zlibCompressedBinaryArrayCount = $zlibBinaryArrayCount
            allBinaryArraysZlib = $binaryArrayCount -gt 0 -and $zlibBinaryArrayCount -eq $binaryArrayCount
            profileObserved = $profileTermCount -gt 0 -or $mzXmlProfileScanCount -gt 0
            centroidObserved = $centroidTermCount -gt 0 -or $mzXmlCentroidScanCount -gt 0
            profileTermCount = $profileTermCount
            centroidTermCount = $centroidTermCount
            mzXmlProfileScanCount = $mzXmlProfileScanCount
            mzXmlCentroidScanCount = $mzXmlCentroidScanCount
            mzXmlUnknownRepresentationScanCount = $mzXmlUnknownRepresentationScanCount
            precision32Observed = $precision32
            precision64Observed = $precision64
        }
    }
    finally { $reader.Dispose() }
}

function Test-ConversionOutput {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][ValidateSet("mzML", "mzXML")][string]$Format,
        [Parameter(Mandatory = $true)][hashtable]$InputStructure
    )
    $entries = @(Get-ChildItem -LiteralPath $Directory -Force)
    if ($entries.Count -eq 0) {
        return [ordered]@{ status = "missing_output" }
    }
    if ($entries | Where-Object { $_.Name -match '(?i)\.(part|partial|tmp)$' }) {
        return [ordered]@{ status = "partial_output" }
    }
    if ($entries.Count -ne 1 -or $entries[0].PSIsContainer -or
        ($entries[0].Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or
        $entries[0].Extension -notmatch "^(?i:\.$Format)$") {
        return [ordered]@{ status = "unexpected_output" }
    }
    $file = $entries[0]
    if ($file.Length -eq 0) {
        return [ordered]@{ status = "zero_byte_output" }
    }
    try { $structure = Get-XmlStructure $file.FullName }
    catch {
        return [ordered]@{
            status = "malformed_xml"
            bytes = [int64]$file.Length
            sha256 = Get-UpperSha256 $file.FullName
        }
    }
    $rootValid = if ($Format -eq "mzML") {
        $structure.root -in @("mzML", "indexedmzML")
    }
    else { $structure.root -eq "mzXML" }
    if (-not $rootValid -or $structure.spectrumCount -le 0) {
        return [ordered]@{
            status = "invalid_root_or_structure"
            bytes = [int64]$file.Length
            sha256 = Get-UpperSha256 $file.FullName
            structure = $structure
        }
    }
    $spectrumCountMatches = $structure.spectrumCount -eq $InputStructure.spectrumCount
    $chromatogramCountMatches = $structure.chromatogramCount -eq $InputStructure.chromatogramCount
    $expectedMzXmlChromatogramLoss = $Format -eq "mzXML" -and
        $InputStructure.chromatogramCount -gt 0 -and $structure.chromatogramCount -eq 0
    $chromatogramContractSatisfied = if ($Format -eq "mzML") {
        $chromatogramCountMatches
    }
    else { $structure.chromatogramCount -eq 0 }
    $validCore = $spectrumCountMatches -and $chromatogramContractSatisfied -and
        $structure.allBinaryArraysZlib
    $status = if (-not $validCore) {
        "structure_or_compression_mismatch"
    }
    elseif ($expectedMzXmlChromatogramLoss) {
        "valid_with_expected_chromatogram_loss"
    }
    else { "valid" }
    return [ordered]@{
        status = $status
        bytes = [int64]$file.Length
        sha256 = Get-UpperSha256 $file.FullName
        root = $structure.root
        spectrumCount = $structure.spectrumCount
        chromatogramCount = $structure.chromatogramCount
        spectrumCountMatchesInput = $spectrumCountMatches
        chromatogramCountMatchesInput = $chromatogramCountMatches
        expectedMzXmlChromatogramLoss = $expectedMzXmlChromatogramLoss
        chromatogramContractSatisfied = $chromatogramContractSatisfied
        binaryArrayCount = $structure.binaryArrayCount
        zlibCompressedBinaryArrayCount = $structure.zlibCompressedBinaryArrayCount
        allBinaryArraysZlib = $structure.allBinaryArraysZlib
        profileObserved = $structure.profileObserved
        centroidObserved = $structure.centroidObserved
        profileTermCount = $structure.profileTermCount
        centroidTermCount = $structure.centroidTermCount
        mzXmlProfileScanCount = $structure.mzXmlProfileScanCount
        mzXmlCentroidScanCount = $structure.mzXmlCentroidScanCount
        mzXmlUnknownRepresentationScanCount = $structure.mzXmlUnknownRepresentationScanCount
        precision32Observed = $structure.precision32Observed
        precision64Observed = $structure.precision64Observed
        representationComparison = [ordered]@{
            inputProfileObserved = $InputStructure.profileObserved
            inputCentroidObserved = $InputStructure.centroidObserved
            outputProfileObserved = $structure.profileObserved
            outputCentroidObserved = $structure.centroidObserved
            descriptiveMarkersMatch = $InputStructure.profileObserved -eq $structure.profileObserved -and
                $InputStructure.centroidObserved -eq $structure.centroidObserved
            interpretation = "descriptive_only_not_proof_of_unchanged_representation"
        }
        chromatogramRepresentationChange = [ordered]@{
            inputCount = $InputStructure.chromatogramCount
            outputCount = $structure.chromatogramCount
            expectedFormatLoss = $expectedMzXmlChromatogramLoss
        }
        representationEquivalenceClaimed = $false
        losslessnessClaimed = $false
        xmlReaderDtdProhibited = $true
        xmlResolverDisabled = $true
    }
}

function Invoke-ConversionValidatorSelfTest {
    param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$Layout)
    $root = Join-Path $Layout.temp ("validator-selftest-" + [Guid]::NewGuid().ToString('N'))
    [System.IO.Directory]::CreateDirectory($root) | Out-Null
    $oneSpectrum = @{
        spectrumCount = 1
        chromatogramCount = 0
        profileObserved = $true
        centroidObserved = $false
    }
    try {
        $cases = @{}
        $missing = Join-Path $root "missing"
        [System.IO.Directory]::CreateDirectory($missing) | Out-Null
        $cases.missing = (Test-ConversionOutput $missing "mzML" $oneSpectrum).status

        $zero = Join-Path $root "zero"
        [System.IO.Directory]::CreateDirectory($zero) | Out-Null
        [System.IO.File]::WriteAllBytes((Join-Path $zero "out.mzML"), [byte[]]::new(0))
        $cases.zero = (Test-ConversionOutput $zero "mzML" $oneSpectrum).status

        $partial = Join-Path $root "partial"
        [System.IO.Directory]::CreateDirectory($partial) | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $partial "out.mzML.partial"), "partial")
        $cases.partial = (Test-ConversionOutput $partial "mzML" $oneSpectrum).status

        $extra = Join-Path $root "extra"
        [System.IO.Directory]::CreateDirectory($extra) | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $extra "one.mzML"), "one")
        [System.IO.File]::WriteAllText((Join-Path $extra "two.mzML"), "two")
        $cases.extra = (Test-ConversionOutput $extra "mzML" $oneSpectrum).status

        $malformed = Join-Path $root "malformed"
        [System.IO.Directory]::CreateDirectory($malformed) | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $malformed "out.mzML"), "<mzML><broken>")
        $cases.malformed = (Test-ConversionOutput $malformed "mzML" $oneSpectrum).status

        $dtd = Join-Path $root "dtd"
        [System.IO.Directory]::CreateDirectory($dtd) | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $dtd "out.mzML"),
            '<!DOCTYPE mzML [<!ENTITY x "blocked">]><mzML><run><spectrumList><spectrum/></spectrumList></run></mzML>')
        $cases.dtd = (Test-ConversionOutput $dtd "mzML" $oneSpectrum).status

        $wrongRoot = Join-Path $root "wrong-root"
        [System.IO.Directory]::CreateDirectory($wrongRoot) | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $wrongRoot "out.mzML"), "<notMzML><spectrum/></notMzML>")
        $cases.wrongRoot = (Test-ConversionOutput $wrongRoot "mzML" $oneSpectrum).status

        $validMzMl = Join-Path $root "valid-mzml"
        [System.IO.Directory]::CreateDirectory($validMzMl) | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $validMzMl "out.mzML"),
            '<mzML><run><spectrumList count="1"><spectrum id="scan=1"><binaryDataArrayList><binaryDataArray><cvParam accession="MS:1000574" name="zlib compression"/></binaryDataArray></binaryDataArrayList></spectrum></spectrumList></run></mzML>')
        $cases.validMzMl = (Test-ConversionOutput $validMzMl "mzML" $oneSpectrum).status

        $validMzXml = Join-Path $root "valid-mzxml"
        [System.IO.Directory]::CreateDirectory($validMzXml) | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $validMzXml "out.mzXML"),
            '<mzXML><msRun scanCount="1"><scan num="1" centroided="0"><peaks precision="32" compressionType="zlib">AA==</peaks></scan></msRun></mzXML>')
        $validMzXmlResult = Test-ConversionOutput $validMzXml "mzXML" $oneSpectrum
        $cases.validMzXml = $validMzXmlResult.status
        if ($validMzXmlResult.mzXmlProfileScanCount -ne 1 -or
            $validMzXmlResult.mzXmlCentroidScanCount -ne 0) {
            Stop-Evidence "conversion_validator_selftest_failed"
        }

        $mixedZlib = Join-Path $root "mixed-zlib"
        [System.IO.Directory]::CreateDirectory($mixedZlib) | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $mixedZlib "out.mzML"),
            '<mzML><cvParam accession="MS:1000574" name="zlib compression"/><run><spectrumList count="1"><spectrum><binaryDataArrayList><binaryDataArray><cvParam accession="MS:1000574" name="zlib compression"/></binaryDataArray><binaryDataArray><cvParam accession="MS:1000576" name="no compression"/></binaryDataArray></binaryDataArrayList></spectrum></spectrumList></run></mzML>')
        $cases.mixedZlib = (Test-ConversionOutput $mixedZlib "mzML" $oneSpectrum).status

        $mzXmlLoss = Join-Path $root "mzxml-loss"
        [System.IO.Directory]::CreateDirectory($mzXmlLoss) | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $mzXmlLoss "out.mzXML"),
            '<mzXML><msRun scanCount="1"><scan num="1" centroided="1"><peaks precision="64" compressionType="zlib">AA==</peaks></scan></msRun></mzXML>')
        $inputWithChromatogram = @{
            spectrumCount = 1
            chromatogramCount = 1
            profileObserved = $true
            centroidObserved = $false
        }
        $mzXmlLossResult = Test-ConversionOutput $mzXmlLoss "mzXML" $inputWithChromatogram
        $cases.mzXmlExpectedLoss = $mzXmlLossResult.status
        if (-not $mzXmlLossResult.expectedMzXmlChromatogramLoss -or
            $mzXmlLossResult.mzXmlCentroidScanCount -ne 1) {
            Stop-Evidence "conversion_validator_selftest_failed"
        }

        $mzXmlUncompressed = Join-Path $root "mzxml-uncompressed"
        [System.IO.Directory]::CreateDirectory($mzXmlUncompressed) | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $mzXmlUncompressed "out.mzXML"),
            '<mzXML><msRun scanCount="1"><scan num="1" centroided="0"><peaks precision="32" compressionType="none">AA==</peaks></scan></msRun></mzXML>')
        $cases.mzXmlUncompressed = (Test-ConversionOutput $mzXmlUncompressed "mzXML" $oneSpectrum).status

        $expected = @{
            missing = "missing_output"
            zero = "zero_byte_output"
            partial = "partial_output"
            extra = "unexpected_output"
            malformed = "malformed_xml"
            dtd = "malformed_xml"
            wrongRoot = "invalid_root_or_structure"
            validMzMl = "valid"
            validMzXml = "valid"
            mixedZlib = "structure_or_compression_mismatch"
            mzXmlExpectedLoss = "valid_with_expected_chromatogram_loss"
            mzXmlUncompressed = "structure_or_compression_mismatch"
        }
        foreach ($name in $expected.Keys) {
            if ($cases[$name] -ne $expected[$name]) {
                Stop-Evidence "conversion_validator_selftest_failed"
            }
        }
        return [ordered]@{
            passed = $true
            caseCount = $expected.Count
            dtdProhibitionExercised = $true
            temporaryVectorsDeleted = $true
        }
    }
    finally {
        if ([System.IO.Directory]::Exists($root)) { [System.IO.Directory]::Delete($root, $true) }
    }
}

function Assert-SelfTestRejects {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Action,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )
    try { [void](& $Action) }
    catch {
        if ($_.Exception.Message -match '^M0C:[a-z0-9_]+$') { return }
        throw
    }
    Stop-Evidence $FailureCode
}

function Assert-SelfTestRejectsWithCode {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Action,
        [Parameter(Mandatory = $true)][string]$ExpectedCode,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )
    try { [void](& $Action) }
    catch {
        if ((Get-StableFailureCode $_) -ceq $ExpectedCode) { return }
        Stop-Evidence $FailureCode
    }
    Stop-Evidence $FailureCode
}

function New-FirewallRuleProjectionSelfTestFixture {
    param([AllowNull()][AllowEmptyCollection()][uint16[]]$EnforcementCodes)
    return [pscustomobject]@{
        Name = "M0C-selftest-rule"
        DisplayName = "MSCanvas disposable M0C outbound block"
        Direction = "Outbound"
        Action = "Block"
        Enabled = "True"
        Profile = "Any"
        PrimaryStatus = "OK"
        CimInstanceProperties = @{
            EnforcementStatus = [pscustomobject]@{
                CimType = "UInt16Array"
                Value = $EnforcementCodes
            }
        }
    }
}

function Invoke-FirewallRuleProjectionSelfTest {
    $name = "M0C-selftest-rule"
    $program = 'X:\isolated\tool.exe'
    $application = [pscustomobject]@{ Program = $program }

    $arrayRule = New-FirewallRuleProjectionSelfTestFixture `
        -EnforcementCodes ([uint16[]]@(5, 1, 1, 1))
    Assert-FirewallRuleProjection -Rules @($arrayRule) -Applications @($application) `
        -ExpectedName $name -ExpectedProgramPath $program `
        -RawEnforcementProperty $arrayRule.CimInstanceProperties.EnforcementStatus
    $singleRule = New-FirewallRuleProjectionSelfTestFixture -EnforcementCodes ([uint16[]]@(1))
    Assert-FirewallRuleProjection -Rules @($singleRule) -Applications @($application) `
        -ExpectedName $name -ExpectedProgramPath $program `
        -RawEnforcementProperty $singleRule.CimInstanceProperties.EnforcementStatus

    $missingRule = New-FirewallRuleProjectionSelfTestFixture -EnforcementCodes ([uint16[]]@())
    Assert-SelfTestRejectsWithCode {
        Assert-FirewallRuleProjection -Rules @($missingRule) -Applications @($application) `
            -ExpectedName $name -ExpectedProgramPath $program `
            -RawEnforcementProperty $missingRule.CimInstanceProperties.EnforcementStatus
    } "firewall_rule_enforcement_status_missing" "firewall_projection_selftest_rejection_failed"
    $inactiveRule = New-FirewallRuleProjectionSelfTestFixture `
        -EnforcementCodes ([uint16[]]@(5))
    Assert-SelfTestRejectsWithCode {
        Assert-FirewallRuleProjection -Rules @($inactiveRule) -Applications @($application) `
            -ExpectedName $name -ExpectedProgramPath $program `
            -RawEnforcementProperty $inactiveRule.CimInstanceProperties.EnforcementStatus
    } "firewall_rule_no_active_enforcement" "firewall_projection_selftest_rejection_failed"
    $blockingCodes = @([uint16]0, 2, 3, 4) + @((6..24) | ForEach-Object { [uint16]$_ })
    foreach ($blockingCode in $blockingCodes) {
        $blockedRule = New-FirewallRuleProjectionSelfTestFixture `
            -EnforcementCodes ([uint16[]]@(1, $blockingCode))
        Assert-SelfTestRejectsWithCode {
            Assert-FirewallRuleProjection -Rules @($blockedRule) -Applications @($application) `
                -ExpectedName $name -ExpectedProgramPath $program `
                -RawEnforcementProperty $blockedRule.CimInstanceProperties.EnforcementStatus
        } "firewall_rule_blocking_reason_present" "firewall_projection_selftest_rejection_failed"
    }
    $wrongShapeRule = New-FirewallRuleProjectionSelfTestFixture -EnforcementCodes ([uint16[]]@(1))
    $wrongShapeRule.CimInstanceProperties.EnforcementStatus.CimType = "StringArray"
    Assert-SelfTestRejectsWithCode {
        Assert-FirewallRuleProjection -Rules @($wrongShapeRule) -Applications @($application) `
            -ExpectedName $name -ExpectedProgramPath $program `
            -RawEnforcementProperty $wrongShapeRule.CimInstanceProperties.EnforcementStatus
    } "firewall_rule_enforcement_status_shape_invalid" "firewall_projection_selftest_rejection_failed"
    $wrongActionRule = New-FirewallRuleProjectionSelfTestFixture -EnforcementCodes ([uint16[]]@(1))
    $wrongActionRule.Action = "Allow"
    Assert-SelfTestRejectsWithCode {
        Assert-FirewallRuleProjection -Rules @($wrongActionRule) -Applications @($application) `
            -ExpectedName $name -ExpectedProgramPath $program `
            -RawEnforcementProperty $wrongActionRule.CimInstanceProperties.EnforcementStatus
    } "firewall_rule_action_invalid" "firewall_projection_selftest_rejection_failed"
    $wrongApplication = [pscustomobject]@{ Program = 'X:\isolated\other.exe' }
    Assert-SelfTestRejectsWithCode {
        Assert-FirewallRuleProjection -Rules @($singleRule) -Applications @($wrongApplication) `
            -ExpectedName $name -ExpectedProgramPath $program `
            -RawEnforcementProperty $singleRule.CimInstanceProperties.EnforcementStatus
    } "firewall_rule_program_path_invalid" "firewall_projection_selftest_rejection_failed"

    return [ordered]@{
        passed = $true
        acceptedRawCimShapes = 2
        profileInactiveAcceptedWithEnforced = $true
        rejectedCaseCount = $blockingCodes.Count + 5
        allKnownBlockingReasonsRejected = $true
    }
}

function Invoke-ArchiveMemberSelfTest {
    param([Parameter(Mandatory = $true)][string]$TempRoot)
    $validationRoot = Join-Path $TempRoot "archive-member-validation-target"
    $prefixedKey = Get-ValidatedArchiveMemberKey -Portable "./x" -ToolsDirectory $validationRoot
    $plainKey = Get-ValidatedArchiveMemberKey -Portable "x" -ToolsDirectory $validationRoot
    if ($prefixedKey -cne "x" -or $plainKey -cne "x") {
        Stop-Evidence "archive_member_selftest_normalization_failed"
    }
    foreach ($unsafe in @("./../x", "././x", ".//x", "./C:/x")) {
        Assert-SelfTestRejects {
            Get-ValidatedArchiveMemberKey -Portable $unsafe -ToolsDirectory $validationRoot
        } "archive_member_selftest_rejection_failed"
    }
    $duplicates = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    if (-not $duplicates.Add($prefixedKey) -or $duplicates.Add($plainKey)) {
        Stop-Evidence "archive_member_selftest_duplicate_failed"
    }

    $tar = Join-Path $env:SystemRoot "System32\tar.exe"
    if (-not [System.IO.File]::Exists($tar)) {
        Stop-Evidence "archive_member_selftest_tool_missing"
    }
    $root = Join-Path $TempRoot ("archive-member-selftest-" + [Guid]::NewGuid().ToString('N'))
    $source = Join-Path $root "source"
    $archive = Join-Path $root "fixture.tar"
    [System.IO.Directory]::CreateDirectory($source) | Out-Null
    try {
        [System.IO.File]::WriteAllText((Join-Path $source "x"), "synthetic archive member")
        $createOutput = @(& $tar -cf $archive -C $source . 2>&1)
        if ($LASTEXITCODE -ne 0 -or $createOutput.Count -ne 0) {
            Stop-Evidence "archive_member_selftest_creation_failed"
        }
        $members = @(& $tar -tf $archive 2>&1)
        if ($LASTEXITCODE -ne 0 -or $members.Count -ne 2 -or
            -not ($members | Where-Object { $_ -in @('.', './') } | Select-Object -First 1) -or
            -not ($members | Where-Object { $_ -ceq './x' } | Select-Object -First 1)) {
            Stop-Evidence "archive_member_selftest_listing_failed"
        }
        $syntheticKeys = [System.Collections.Generic.HashSet[string]]::new(
            [System.StringComparer]::OrdinalIgnoreCase
        )
        foreach ($member in $members) {
            $portable = ([string]$member).Replace('\', '/')
            if ($portable -in @('.', './')) { continue }
            $key = Get-ValidatedArchiveMemberKey -Portable $portable -ToolsDirectory $validationRoot
            if (-not $syntheticKeys.Add($key)) {
                Stop-Evidence "archive_member_selftest_synthetic_duplicate"
            }
        }
        if ($syntheticKeys.Count -ne 1 -or -not $syntheticKeys.Contains("x")) {
            Stop-Evidence "archive_member_selftest_synthetic_normalization_failed"
        }
    }
    finally {
        if ([System.IO.Directory]::Exists($root)) {
            [System.IO.Directory]::Delete($root, $true)
        }
    }
    return [ordered]@{
        passed = $true
        pureAcceptedCases = 2
        pureRejectedCases = 4
        duplicateCollisionVerified = $true
        syntheticTarVerified = $true
    }
}

function Invoke-SanitizerSelfTest {
    $dangerous = @(
        'source=(D:\a\b)',
        'file://F:/data/Exp01',
        'file:///C:/settings/',
        '{"path":"C:\\settings\\x"}',
        '{"uri":"file:\/\/F:\/data"}'
    )
    foreach ($value in $dangerous) {
        if ($null -ne (ConvertTo-SanitizedScientificLine $value)) {
            Stop-Evidence "sanitizer_selftest_failed"
        }
    }
    $patterns = @(Get-ForbiddenEvidencePatterns)
    foreach ($value in @($dangerous + 'scientific.stdout_base64[0]=QUJD')) {
        if (-not ($patterns | Where-Object { $value -match $_ } | Select-Object -First 1)) {
            Stop-Evidence "sanitizer_selftest_failed"
        }
    }
    $safe = 'https://example.test/open-format?id=scan-1'
    if ((ConvertTo-SanitizedScientificLine $safe) -cne $safe -or
        ($patterns | Where-Object { $safe -match $_ } | Select-Object -First 1)) {
        Stop-Evidence "sanitizer_selftest_failed"
    }
    return [ordered]@{ passed = $true; caseCount = $dangerous.Count + 2 }
}

function Get-NormalizedBackendExitCode {
    param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$Facts)
    if (-not $Facts.Contains("process.exit_code")) { return $null }
    $text = [string]$Facts["process.exit_code"]
    if ($text -match '^Some\((-?\d+)\)$' -or $text -match '^(-?\d+)$') {
        $value = 0
        if ([int]::TryParse($Matches[1], [Globalization.NumberStyles]::Integer,
                [Globalization.CultureInfo]::InvariantCulture, [ref]$value)) {
            return $value
        }
    }
    if ($text -eq "None") { return $null }
    Stop-Evidence "backend_exit_code_invalid"
}

function Get-RunnerEvidence {
    if ($env:GITHUB_RUN_ID -notmatch '^[1-9][0-9]*$' -or
        $env:GITHUB_RUN_ATTEMPT -notmatch '^[1-9][0-9]*$' -or
        $env:GITHUB_JOB -cne "runtime_evidence") {
        Stop-Evidence "workflow_identity_environment_invalid"
    }
    $operatingSystem = Get-CimInstance -ClassName Win32_OperatingSystem
    $computerSystem = Get-CimInstance -ClassName Win32_ComputerSystem
    if ($null -eq $operatingSystem -or $null -eq $computerSystem) {
        Stop-Evidence "runner_evidence_unavailable"
    }
    return [ordered]@{
        workflow = [ordered]@{
            runId = [string]$env:GITHUB_RUN_ID
            runAttempt = [int]$env:GITHUB_RUN_ATTEMPT
            currentJobKey = "runtime_evidence"
            currentJobName = "Run isolated open-format evidence"
            buildJobKey = "build_harness"
            buildJobName = "Build and attest evidence harness"
            databaseJobIds = "reconcile_after_run_via_authenticated_api"
        }
        requestedLabel = "windows-2025"
        imageOs = $(if ([string]::IsNullOrWhiteSpace($env:ImageOS)) { "unavailable" } else { $env:ImageOS })
        imageVersion = $(if ([string]::IsNullOrWhiteSpace($env:ImageVersion)) { "unavailable" } else { $env:ImageVersion })
        windowsCaption = [string]$operatingSystem.Caption
        windowsVersion = [string]$operatingSystem.Version
        windowsBuild = [string]$operatingSystem.BuildNumber
        architecture = [string]$env:PROCESSOR_ARCHITECTURE
        logicalProcessors = [int]$computerSystem.NumberOfLogicalProcessors
        totalPhysicalMemoryBytes = [int64]$computerSystem.TotalPhysicalMemory
        culture = [System.Globalization.CultureInfo]::CurrentCulture.Name
        uiCulture = [System.Globalization.CultureInfo]::CurrentUICulture.Name
    }
}

function Get-OperationOutcome {
    param([Parameter(Mandatory = $true)][string]$Name)
    $operation = $script:Summary.operations | Where-Object { $_.name -eq $Name } | Select-Object -Last 1
    if ($null -eq $operation) { return "not_run" }
    if ($operation.timedOut) { return "timed_out" }
    if ($null -eq $operation.backendExitCode) {
        if ($operation.harnessExitCode -eq 0) { return "observed_no_backend_exit" }
        return "observed_pre_execution_failure"
    }
    if ($operation.backendExitCode -eq 0) { return "observed_backend_exit_0" }
    return "observed_backend_exit_$($operation.backendExitCode)"
}

function Get-RecordedOperation {
    param([Parameter(Mandatory = $true)][string]$Name)
    return $script:Summary.operations | Where-Object { $_.name -eq $Name } | Select-Object -Last 1
}

function Assert-ApprovedFixtureHost {
    param(
        [Parameter(Mandatory = $true)][uri]$Uri,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )
    if ($Uri.Scheme -cne "https" -or $ApprovedFixtureHosts -notcontains $Uri.Host) {
        Stop-Evidence $FailureCode
    }
}

function Invoke-JsonApi {
    param(
        [Parameter(Mandatory = $true)][uri]$Uri,
        [Parameter(Mandatory = $true)][string]$FailurePrefix
    )
    if ($Uri.Scheme -cne "https" -or $Uri.Host -cne "www.ebi.ac.uk") {
        Stop-Evidence "${FailurePrefix}_host_invalid"
    }
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromMinutes(2)
    try {
        $response = $client.GetAsync($Uri).GetAwaiter().GetResult()
        try {
            if ($response.StatusCode -ne [System.Net.HttpStatusCode]::OK) {
                Stop-Evidence "${FailurePrefix}_http_status"
            }
            $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        }
        finally { $response.Dispose() }
    }
    finally {
        $client.Dispose()
        $handler.Dispose()
    }
    try { return $text | ConvertFrom-Json }
    catch { Stop-Evidence "${FailurePrefix}_json_invalid" }
}

# Extracts location URLs from PRIDE's controlled-vocabulary location records.
# Each entry is an object carrying its URL in `value`; a plain string is also
# accepted so a future shape change degrades to a comparison rather than a crash.
function Get-PublicFileLocationValues {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Locations)
    $values = @()
    foreach ($location in $Locations) {
        if ($location -is [string]) { $values += [string]$location; continue }
        $value = $location.PSObject.Properties['value']
        if ($null -ne $value -and -not [string]::IsNullOrWhiteSpace([string]$value.Value)) {
            $values += [string]$value.Value
        }
    }
    return @($values)
}

# Re-queries the live PRIDE record and refuses to proceed unless the accession,
# public license and advertised size still match the approved gate. The file
# name itself is compared but never recorded.
function Assert-RepresentativeProvenance {
    $project = Invoke-JsonApi -Uri $PrideProjectApi -FailurePrefix "representative_project"
    if ([string]$project.accession -cne $RepresentativeAccession) {
        Stop-Evidence "representative_accession_mismatch"
    }
    if ([string]$project.license -cne $RepresentativeLicense) {
        Stop-Evidence "representative_license_mismatch"
    }

    $files = Invoke-JsonApi -Uri $PrideFilesApi -FailurePrefix "representative_files"
    $match = @($files | Where-Object { [string]$_.fileName -ceq $RepresentativeFileName })
    if ($match.Count -ne 1) { Stop-Evidence "representative_file_not_listed" }
    $entry = $match[0]
    if ([int64]$entry.fileSizeBytes -ne $RepresentativeBytes) {
        Stop-Evidence "representative_advertised_size_mismatch"
    }

    $approvedUri = [uri]$RepresentativeUrl
    Assert-ApprovedFixtureHost -Uri $approvedUri -FailureCode "representative_host_not_approved"
    # publicFileLocations entries are CvParam objects whose URL lives in `value`.
    $locations = @(Get-PublicFileLocationValues $entry.publicFileLocations)
    $ftpMatch = @($locations | Where-Object {
        $_ -cmatch '^ftp://ftp\.pride\.ebi\.ac\.uk(/.+)$' -and
        $Matches[1] -ceq $approvedUri.AbsolutePath
    })
    if ($ftpMatch.Count -lt 1) { Stop-Evidence "representative_location_not_approved" }

    return [ordered]@{
        alias = $RepresentativeAlias
        accession = $RepresentativeAccession
        licenseVerified = $true
        license = $RepresentativeLicense
        advertisedBytes = $RepresentativeBytes
        approvedHost = $approvedUri.Host
        officialLocationConfirmed = $true
        vendorData = $false
        fileNamePublished = $false
    }
}

# Downloads the representative fixture with no redirect allowance, requires the
# exact advertised length, and returns the measured SHA-256. When a pinned hash
# is supplied the download must match it exactly.
function Invoke-MeasuredDownload {
    param(
        [Parameter(Mandatory = $true)][uri]$Uri,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][int64]$ExpectedBytes,
        [AllowEmptyString()][string]$PinnedSha,
        [Parameter(Mandatory = $true)][string]$FailurePrefix
    )
    Assert-ApprovedFixtureHost -Uri $Uri -FailureCode "${FailurePrefix}_host_not_approved"
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromMinutes(20)
    try {
        $response = $client.GetAsync($Uri, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        try {
            if ($response.StatusCode -ne [System.Net.HttpStatusCode]::OK) {
                Stop-Evidence "${FailurePrefix}_http_status"
            }
            if ($null -ne $response.RequestMessage -and
                [string]$response.RequestMessage.RequestUri -cne [string]$Uri) {
                Stop-Evidence "${FailurePrefix}_final_uri_changed"
            }
            if ($null -ne $response.Content.Headers.ContentLength -and
                [int64]$response.Content.Headers.ContentLength -ne $ExpectedBytes) {
                Stop-Evidence "${FailurePrefix}_content_length_mismatch"
            }
            $source = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
            try {
                $target = [System.IO.FileStream]::new(
                    $Destination,
                    [System.IO.FileMode]::CreateNew,
                    [System.IO.FileAccess]::Write,
                    [System.IO.FileShare]::None
                )
                try { $source.CopyTo($target) }
                finally { $target.Dispose() }
            }
            finally { $source.Dispose() }
        }
        finally { $response.Dispose() }
    }
    finally {
        $client.Dispose()
        $handler.Dispose()
    }

    $item = Get-Item -LiteralPath $Destination -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        Stop-Evidence "${FailurePrefix}_reparse_point"
    }
    if ($item.PSIsContainer -or [int64]$item.Length -ne $ExpectedBytes) {
        Stop-Evidence "${FailurePrefix}_length_mismatch"
    }
    $measured = Get-UpperSha256 $Destination
    if (-not [string]::IsNullOrWhiteSpace($PinnedSha) -and
        $measured -cne $PinnedSha.ToUpperInvariant()) {
        Stop-Evidence "${FailurePrefix}_pinned_hash_mismatch"
    }
    return $measured
}

function Assert-SufficientFreeDisk {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    $root = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($LiteralPath))
    $drive = Get-PSDrive -Name $root.Substring(0, 1) -ErrorAction SilentlyContinue
    if ($null -eq $drive -or $null -eq $drive.Free -or [int64]$drive.Free -lt $MinimumFreeDiskBytes) {
        Stop-Evidence "insufficient_free_disk_space"
    }
    return [int64]$drive.Free
}

# One harness invocation. The harness owns every typed judgement; this records
# the sanitized facts it printed plus the launcher-observed timings.
function Invoke-HarnessOperation {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Fixture,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string[]]$SanitizedArguments,
        [Parameter(Mandatory = $true)][hashtable]$Account,
        [Parameter(Mandatory = $true)][System.Security.SecureString]$Password,
        [Parameter(Mandatory = $true)][string]$HarnessPath,
        [Parameter(Mandatory = $true)][System.Collections.Generic.IDictionary[string, string]]$Environment,
        [Parameter(Mandatory = $true)][hashtable]$Layout,
        [AllowEmptyString()][string]$OutputDirectory,
        [int]$TimeoutMilliseconds = 600000,
        [switch]$AllowTypedFailure,
        [switch]$Record
    )
    $result = Invoke-SecureProcess -Account $Account -Password $Password -Application $HarnessPath `
        -Arguments $Arguments -Environment $Environment -Layout $Layout -TimeoutMilliseconds $TimeoutMilliseconds
    $stdoutText = Get-Utf8Text $result.Stdout
    $facts = ConvertFrom-HarnessFacts $stdoutText
    if ($result.TimedOut -or $result.StdoutTruncated -or $result.StderrTruncated -or
        $result.StdoutTotalBytes -ne $result.Stdout.Length -or
        $result.StderrTotalBytes -ne $result.Stderr.Length) {
        Stop-Evidence "operation_capture_incomplete"
    }
    if ($result.ExitCode -ne 0 -and -not $AllowTypedFailure) {
        Stop-Evidence "operation_unexpected_harness_failure"
    }

    $inventory = $null
    if (-not [string]::IsNullOrWhiteSpace($OutputDirectory)) {
        $inventory = Get-OutputInventory $OutputDirectory
    }
    $backendExitCode = Get-NormalizedBackendExitCode $facts
    $operation = [ordered]@{
        name = $Name
        fixture = $Fixture
        sanitizedArgv = @($SanitizedArguments)
        harnessExitCode = $result.ExitCode
        backendExitCode = $backendExitCode
        launcherElapsedMs = $result.ElapsedMilliseconds
        backendElapsedMs = Get-FactInt64 $facts "process.elapsed_ms"
        parserElapsedMs = Get-FactInt64 $facts "process.parser_elapsed_ms"
        commandStartupUpperBoundMs = $null
        peakJobMemoryBytes = Get-FactInt64 $facts "process.peak_job_memory_bytes"
        timedOut = $result.TimedOut
        captureComplete = $true
        stdoutTotalBytes = $result.StdoutTotalBytes
        stderrTotalBytes = $result.StderrTotalBytes
        stdoutTruncated = $result.StdoutTruncated
        stderrTruncated = $result.StderrTruncated
        previewInterpretation = Get-FactString $facts "preview.interpretation"
        previewResultKind = Get-FactString $facts "preview.result_kind"
        previewErrorKind = Get-FactString $facts "preview.error_kind"
        harnessFacts = $facts
        output = $inventory
    }
    if ($null -ne $operation.backendElapsedMs) {
        $operation.commandStartupUpperBoundMs =
            [Math]::Max(0L, [int64]$result.ElapsedMilliseconds - [int64]$operation.backendElapsedMs)
    }
    if ($Record) { $script:Summary.operations += $operation }
    return $operation
}

function Get-FactString {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Facts,
        [Parameter(Mandatory = $true)][string]$Key
    )
    if ($Facts.Contains($Key)) { return [string]$Facts[$Key] }
    return $null
}

function Get-FactInt64 {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Facts,
        [Parameter(Mandatory = $true)][string]$Key
    )
    $raw = Get-FactString $Facts $Key
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    $parsed = 0L
    if (-not [int64]::TryParse($raw, [ref]$parsed)) { return $null }
    return $parsed
}

function Get-FactBool {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Facts,
        [Parameter(Mandatory = $true)][string]$Key
    )
    $raw = Get-FactString $Facts $Key
    if ($raw -ceq "true") { return $true }
    if ($raw -ceq "false") { return $false }
    return $null
}

function Get-LatencyStatistics {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][int64[]]$Values)
    if ($Values.Count -eq 0) {
        return [ordered]@{ count = 0; p50Ms = $null; p95Ms = $null; maximumMs = $null }
    }
    $sorted = @($Values | Sort-Object)
    $percentile = {
        param([double]$Fraction)
        $index = [Math]::Ceiling($Fraction * $sorted.Count) - 1
        if ($index -lt 0) { $index = 0 }
        if ($index -ge $sorted.Count) { $index = $sorted.Count - 1 }
        return [int64]$sorted[$index]
    }
    return [ordered]@{
        count = $sorted.Count
        p50Ms = (& $percentile 0.50)
        p95Ms = (& $percentile 0.95)
        maximumMs = [int64]$sorted[$sorted.Count - 1]
        observationBasis = "n=$($sorted.Count) on one shared hosted runner; advisory only"
    }
}

# The deterministic navigation order. It is a pure function of the spectrum
# count, so any reviewer can regenerate the exact sequence.
function Get-NavigationSequence {
    param([Parameter(Mandatory = $true)][int64]$SpectrumCount)
    if ($SpectrumCount -le 0) { return @() }
    $seen = [System.Collections.Generic.HashSet[int64]]::new()
    $sequence = @()
    for ($k = 0; $k -lt $NavigationSequenceLength; $k++) {
        $index = [int64](($k * $NavigationMultiplier) % $SpectrumCount)
        if ($seen.Add($index)) { $sequence += $index }
    }
    return @($sequence)
}

function Get-SampledSpectrumIndices {
    param(
        [Parameter(Mandatory = $true)][int64]$SpectrumCount,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$InspectFacts
    )
    if ($SpectrumCount -le 0) { return @() }
    $last = $SpectrumCount - 1
    $candidates = @(
        [ordered]@{ label = "first"; index = 0L },
        [ordered]@{ label = "early_5pct"; index = [int64][Math]::Floor(0.05 * $SpectrumCount) },
        [ordered]@{ label = "middle"; index = [int64][Math]::Floor(0.50 * $SpectrumCount) },
        [ordered]@{ label = "late_95pct"; index = [int64][Math]::Floor(0.95 * $SpectrumCount) },
        [ordered]@{ label = "final_valid"; index = $last }
    )
    foreach ($key in @("first_ms2_index", "array_length.minimum_index",
            "array_length.median_index", "array_length.maximum_index")) {
        $value = Get-FactInt64 $InspectFacts "inspect.$key"
        if ($null -ne $value -and $value -ge 0 -and $value -le $last) {
            $label = switch ($key) {
                "first_ms2_index" { "first_ms2" }
                "array_length.minimum_index" { "smallest_array" }
                "array_length.median_index" { "median_array" }
                default { "largest_array" }
            }
            $candidates += [ordered]@{ label = $label; index = $value }
        }
    }
    $seen = [System.Collections.Generic.HashSet[int64]]::new()
    $selected = @()
    foreach ($candidate in ($candidates | Sort-Object { [int64]$_.index })) {
        if ($seen.Add([int64]$candidate.index)) { $selected += $candidate }
    }
    return @($selected)
}

function Invoke-OrchestrationSelfTests {
    param([Parameter(Mandatory = $true)][string]$TempRoot)
    Add-NativeRuntimeTypes
    if (-not [System.IO.Directory]::Exists($TempRoot)) {
        [System.IO.Directory]::CreateDirectory($TempRoot) | Out-Null
    }
    $layout = @{ temp = $TempRoot }
    $helpFixture = @'
Analysis commands (used with -x/--exec):
  metadata
  run_summary delimiter=tab
  spectrum_table delimiter=tab
  binary index=0 precision=8
  tic delimiter=tab
Examples:
msLevel <mslevels>
'@
    $queries = @(Get-MsAccessAnalysisQueries $helpFixture)
    if ($queries.Count -ne 5) { Stop-Evidence "help_parser_selftest_failed" }
    $emptyCapture = [byte[]]::new(0)
    if ((Get-Sha256OfBytes -Bytes $emptyCapture) -cne
            "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855" -or
        (Get-Utf8Text -Bytes $emptyCapture) -cne "") {
        Stop-Evidence "empty_capture_stream_selftest_failed"
    }
    Assert-SelfTestRejects {
        Get-MsAccessAnalysisQueries ($helpFixture.Replace(
            "Analysis commands (used with -x/--exec):",
            "Analysis commands (used with -x/--exec): near-miss"
        ))
    } "help_parser_selftest_rejection_failed"

    $mockSummary = [ordered]@{
        status = "completed"
        sourceSha = ('0' * 40)
        provenance = [ordered]@{
            archive = [ordered]@{ verified = $true }
            fixture = [ordered]@{ verified = $true }
        }
        isolation = [ordered]@{ standardUserExecutionVerified = $true }
        operations = @()
        teardown = [ordered]@{ cleanupComplete = $true }
    }
    $roundTrippedSummary = $mockSummary | ConvertTo-Json -Depth 8 | ConvertFrom-Json -AsHashtable
    if ((New-SummaryMarkdown $roundTrippedSummary) -notmatch 'Verified teardown complete') {
        Stop-Evidence "summary_roundtrip_selftest_failed"
    }

    # The navigation order must be a pure function of the spectrum count.
    $navigationA = @(Get-NavigationSequence -SpectrumCount 1000)
    $navigationB = @(Get-NavigationSequence -SpectrumCount 1000)
    if ($navigationA.Count -eq 0 -or $navigationA.Count -gt $NavigationSequenceLength -or
        (Compare-Object -ReferenceObject $navigationA -DifferenceObject $navigationB -SyncWindow 0) -or
        (@($navigationA | Where-Object { $_ -lt 0 -or $_ -ge 1000 }).Count -ne 0) -or
        (@($navigationA | Sort-Object -Unique).Count -ne $navigationA.Count)) {
        Stop-Evidence "navigation_sequence_selftest_failed"
    }
    if (@(Get-NavigationSequence -SpectrumCount 0).Count -ne 0) {
        Stop-Evidence "navigation_sequence_selftest_failed"
    }
    $singleSpectrum = @(Get-NavigationSequence -SpectrumCount 1)
    if ($singleSpectrum.Count -ne 1 -or $singleSpectrum[0] -ne 0) {
        Stop-Evidence "navigation_sequence_selftest_failed"
    }

    $latency = Get-LatencyStatistics -Values @(10L, 20L, 30L, 40L, 100L)
    if ($latency.count -ne 5 -or $latency.p50Ms -ne 30 -or $latency.p95Ms -ne 100 -or
        $latency.maximumMs -ne 100) {
        Stop-Evidence "latency_statistics_selftest_failed"
    }
    $emptyLatency = Get-LatencyStatistics -Values @()
    if ($emptyLatency.count -ne 0 -or $null -ne $emptyLatency.p50Ms) {
        Stop-Evidence "latency_statistics_selftest_failed"
    }

    $sampleFacts = [ordered]@{
        "inspect.first_ms2_index" = "3"
        "inspect.array_length.minimum_index" = "7"
        "inspect.array_length.median_index" = "0"
        "inspect.array_length.maximum_index" = "9"
    }
    $sampled = @(Get-SampledSpectrumIndices -SpectrumCount 10 -InspectFacts $sampleFacts)
    $sampledIndices = @($sampled | ForEach-Object { [int64]$_.index })
    if ($sampledIndices.Count -ne (@($sampledIndices | Sort-Object -Unique).Count) -or
        $sampledIndices[0] -ne 0 -or
        (@($sampledIndices | Where-Object { $_ -lt 0 -or $_ -gt 9 }).Count -ne 0) -or
        $sampledIndices -notcontains 9 -or $sampledIndices -notcontains 3 -or
        $sampledIndices -notcontains 7) {
        Stop-Evidence "sampled_index_selftest_failed"
    }

    # PRIDE returns controlled-vocabulary location objects, not plain strings.
    $cvLocations = @(
        [pscustomobject]@{ '@type' = 'CvParam'; name = 'Aspera Protocol'; value = 'prd_ascp@fasp.ebi.ac.uk:pride/x' },
        [pscustomobject]@{ '@type' = 'CvParam'; name = 'FTP Protocol'; value = 'ftp://ftp.pride.ebi.ac.uk/pride/x' }
    )
    $locationValues = @(Get-PublicFileLocationValues $cvLocations)
    if ($locationValues.Count -ne 2 -or
        $locationValues -notcontains 'ftp://ftp.pride.ebi.ac.uk/pride/x') {
        Stop-Evidence "location_shape_selftest_failed"
    }
    if (@(Get-PublicFileLocationValues @('ftp://ftp.pride.ebi.ac.uk/pride/x')).Count -ne 1) {
        Stop-Evidence "location_shape_selftest_failed"
    }
    if (@(Get-PublicFileLocationValues @()).Count -ne 0) {
        Stop-Evidence "location_shape_selftest_failed"
    }

    # The representative file name must never survive sanitization.
    $sanitizerProbe = @("mscanvas-sanitizer-selftest-sentinel")
    Assert-SelfTestRejects {
        Assert-SanitizedEvidenceText -Text "fixture $RepresentativeFileName" -SensitiveValues $sanitizerProbe
    } "representative_name_sanitizer_selftest_failed"
    Assert-SelfTestRejects {
        Assert-SanitizedEvidenceText -Text "prefix BBM_000_sample" -SensitiveValues $sanitizerProbe
    } "representative_prefix_sanitizer_selftest_failed"
    Assert-SanitizedEvidenceText -Text "fixture $RepresentativeAlias" -SensitiveValues $sanitizerProbe

    return [ordered]@{
        embeddedNativeTypesCompiled = $true
        helpParser = [ordered]@{ passed = $true; queryCount = $queries.Count; nearMissRejected = $true }
        emptyCaptureStreams = [ordered]@{ passed = $true; sha256Verified = $true; utf8Verified = $true }
        summaryRoundTrip = [ordered]@{ passed = $true }
        navigationSequence = [ordered]@{
            passed = $true
            deterministic = $true
            requestedLength = $NavigationSequenceLength
            observedLength = $navigationA.Count
        }
        latencyStatistics = [ordered]@{ passed = $true }
        sampledIndices = [ordered]@{ passed = $true }
        representativeNameRedaction = [ordered]@{ passed = $true }
        publicLocationShapes = [ordered]@{ passed = $true; cvParamAccepted = $true; stringAccepted = $true }
        archiveMembers = Invoke-ArchiveMemberSelfTest -TempRoot $TempRoot
        firewallRuleProjection = Invoke-FirewallRuleProjectionSelfTest
        cleanupState = Invoke-CleanupStateSelfTest -TempRoot $TempRoot
        evidencePublication = Invoke-EvidencePublicationSelfTest -TempRoot $TempRoot
        sanitizer = Invoke-SanitizerSelfTest
        conversionValidator = Invoke-ConversionValidatorSelfTest $layout
    }
}

function New-SummaryMarkdown {
    param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$Summary)
    $builder = [System.Text.StringBuilder]::new()
    [void]$builder.AppendLine("# MSCanvas M0C representative navigation and scale evidence")
    [void]$builder.AppendLine()
    [void]$builder.AppendLine("- Status: ``$($Summary.status)``")
    [void]$builder.AppendLine("- Source commit: ``$($Summary.sourceSha)``")
    [void]$builder.AppendLine("- Runner request: ``windows-2025``")
    [void]$builder.AppendLine("- Portable archive identity verified: ``$($Summary.provenance.archive.verified)``")
    [void]$builder.AppendLine("- Synthetic control fixture identity verified: ``$($Summary.provenance.fixture.verified)``")
    if ($Summary.provenance.Contains("representative") -and $null -ne $Summary.provenance.representative) {
        [void]$builder.AppendLine("- Representative fixture alias: ``$($Summary.provenance.representative.alias)``")
        [void]$builder.AppendLine("- Representative license verified: ``$($Summary.provenance.representative.licenseVerified)``")
    }
    [void]$builder.AppendLine("- Standard-user token and isolation proof: ``$($Summary.isolation.standardUserExecutionVerified)``")
    if ($Summary.status -eq "blocked") {
        [void]$builder.AppendLine("- Fail-clean stage: ``$($Summary.failure.stage)``")
        [void]$builder.AppendLine("- Fail-clean code: ``$($Summary.failure.code)``")
    }
    if ($Summary.Contains("teardown") -and $null -ne $Summary.teardown) {
        [void]$builder.AppendLine("- Verified teardown complete: ``$($Summary.teardown.cleanupComplete)``")
    }
    [void]$builder.AppendLine()
    [void]$builder.AppendLine("## Operations")
    [void]$builder.AppendLine()
    [void]$builder.AppendLine("| Operation | Fixture | Backend exit | Harness exit | Preview | Backend ms | Total ms |")
    [void]$builder.AppendLine("| --- | --- | ---: | ---: | --- | ---: | ---: |")
    foreach ($operation in $Summary.operations) {
        $backendOutcome = if ($null -eq $operation.backendExitCode) { "not available" }
            else { [string]$operation.backendExitCode }
        $preview = if ($null -eq $operation.previewInterpretation) { "not applicable" }
            else { [string]$operation.previewInterpretation }
        $backendMs = if ($null -eq $operation.backendElapsedMs) { "n/a" }
            else { [string]$operation.backendElapsedMs }
        [void]$builder.AppendLine("| $($operation.name) | $($operation.fixture) | $backendOutcome | $($operation.harnessExitCode) | $preview | $backendMs | $($operation.launcherElapsedMs) |")
    }
    [void]$builder.AppendLine()
    [void]$builder.AppendLine("## Interpretation rules")
    [void]$builder.AppendLine()
    [void]$builder.AppendLine("Every timing and memory value in this evidence is a single observation on one shared two-core hosted runner and is advisory only. Tiny-control timings are structural, never performance conclusions. Navigation passes are reported separately and are never averaged together; a later pass being faster reflects operating-system and filesystem warmth, not any MSCanvas cache, because no cache exists in this slice. Conversion validity is decided by the typed Rust integrity contract and independently cross-checked by a .NET XmlReader structural pass; the two must agree. The representative acquisition name is never published.")
    return $builder.ToString()
}

# Runs one fixture through the complete navigation and scale matrix.
function Invoke-FixtureMatrix {
    param(
        [Parameter(Mandatory = $true)][string]$Fixture,
        [Parameter(Mandatory = $true)][string]$FixturePath,
        [Parameter(Mandatory = $true)][string]$SanitizedFixture,
        [Parameter(Mandatory = $true)][hashtable]$Account,
        [Parameter(Mandatory = $true)][System.Security.SecureString]$Password,
        [Parameter(Mandatory = $true)][string]$HarnessPath,
        [Parameter(Mandatory = $true)][System.Collections.Generic.IDictionary[string, string]]$Environment,
        [Parameter(Mandatory = $true)][hashtable]$Layout,
        [Parameter(Mandatory = $true)][string]$PortableRoot
    )
    $matrix = [ordered]@{
        fixture = $Fixture
        source = $null
        previewOperations = @()
        selectedSpectra = @()
        unavailableIndices = @()
        navigationPasses = @()
        conversion = $null
        postConversion = $null
    }

    Write-Stage "inspect_source_$Fixture"
    $inspect = Invoke-HarnessOperation -Name "inspect_source" -Fixture $Fixture `
        -Arguments @("--mode", "inspect", "--input", $FixturePath) `
        -SanitizedArguments @("--mode", "inspect", "--input", $SanitizedFixture) `
        -Account $Account -Password $Password -HarnessPath $HarnessPath -Environment $Environment `
        -Layout $Layout -Record
    $inspectFacts = $inspect.harnessFacts
    if ((Get-FactString $inspectFacts "inspect.result") -cne "ok") {
        Stop-Evidence "source_inspection_failed"
    }
    $spectrumCount = Get-FactInt64 $inspectFacts "inspect.observed_spectrum_count"
    if ($null -eq $spectrumCount -or $spectrumCount -le 0) {
        Stop-Evidence "source_spectrum_count_unavailable"
    }
    $matrix.source = [ordered]@{
        root = Get-FactString $inspectFacts "inspect.root"
        declaredSpectrumCount = Get-FactInt64 $inspectFacts "inspect.declared_spectrum_count"
        observedSpectrumCount = $spectrumCount
        declaredChromatogramCount = Get-FactInt64 $inspectFacts "inspect.declared_chromatogram_count"
        observedChromatogramCount = Get-FactInt64 $inspectFacts "inspect.observed_chromatogram_count"
        msLevelDistribution = Get-FactString $inspectFacts "inspect.ms_level_distribution"
        spectrumIndexSequenceConsecutive = Get-FactBool $inspectFacts "inspect.spectrum_index_sequence_consecutive"
        chromatogramIndexSequenceConsecutive = Get-FactBool $inspectFacts "inspect.chromatogram_index_sequence_consecutive"
        parameterGroupReferenceObserved = Get-FactBool $inspectFacts "inspect.parameter_group_reference_observed"
        retentionTimeUnits = Get-FactString $inspectFacts "inspect.retention_time_units"
        scannedBytes = Get-FactInt64 $inspectFacts "inspect.scanned_bytes"
        firstMs2Index = Get-FactInt64 $inspectFacts "inspect.first_ms2_index"
        arrayLengthMinimum = Get-FactInt64 $inspectFacts "inspect.array_length.minimum"
        arrayLengthMedian = Get-FactInt64 $inspectFacts "inspect.array_length.median"
        arrayLengthMaximum = Get-FactInt64 $inspectFacts "inspect.array_length.maximum"
        parserElapsedMs = Get-FactInt64 $inspectFacts "inspect.parser_elapsed_ms"
    }

    Write-Stage "preview_operations_$Fixture"
    $previewPlans = @(
        [ordered]@{ name = "metadata"; mode = "metadata"; extra = @() },
        [ordered]@{ name = "run_summary"; mode = "run-summary"; extra = @() },
        [ordered]@{ name = "spectrum_table"; mode = "spectrum-table"; extra = @() },
        [ordered]@{ name = "tic"; mode = "tic"; extra = @() }
    )
    if ($null -ne $matrix.source.firstMs2Index) {
        $previewPlans += [ordered]@{ name = "tic_ms2"; mode = "tic"; extra = @("--ms-level", "2") }
    }
    foreach ($plan in $previewPlans) {
        $operationName = "$($plan.name)"
        $output = New-OperationDirectory -Layout $Layout -Name "$Fixture-$operationName"
        $arguments = @("--mode", $plan.mode, "--proteowizard-home", $PortableRoot,
            "--input", $FixturePath, "--output-dir", $output) + $plan.extra
        $sanitized = @("--mode", $plan.mode, "--proteowizard-home", "<portable-root>",
            "--input", $SanitizedFixture, "--output-dir", "<output-root>/$Fixture-$operationName") + $plan.extra
        $operation = Invoke-HarnessOperation -Name $operationName -Fixture $Fixture `
            -Arguments $arguments -SanitizedArguments $sanitized -Account $Account -Password $Password `
            -HarnessPath $HarnessPath -Environment $Environment -Layout $Layout `
            -OutputDirectory $output -AllowTypedFailure -Record
        $matrix.previewOperations += [ordered]@{
            name = $operationName
            backendExitCode = $operation.backendExitCode
            harnessExitCode = $operation.harnessExitCode
            previewInterpretation = $operation.previewInterpretation
            previewResultKind = $operation.previewResultKind
            previewErrorKind = $operation.previewErrorKind
            backendElapsedMs = $operation.backendElapsedMs
            parserElapsedMs = $operation.parserElapsedMs
            totalElapsedMs = $operation.launcherElapsedMs
            commandStartupUpperBoundMs = $operation.commandStartupUpperBoundMs
            peakJobMemoryBytes = $operation.peakJobMemoryBytes
            outputBytes = if ($null -eq $operation.output) { $null }
                elseif ($operation.output.files.Count -ge 1) { $operation.output.files[0].bytes }
                else { 0L }
            stdoutTotalBytes = $operation.stdoutTotalBytes
        }
        Remove-OperationDirectory $output
    }

    Write-Stage "selected_spectra_$Fixture"
    foreach ($sample in @(Get-SampledSpectrumIndices -SpectrumCount $spectrumCount -InspectFacts $inspectFacts)) {
        $label = [string]$sample.label
        $index = [int64]$sample.index
        $output = New-OperationDirectory -Layout $Layout -Name "$Fixture-spectrum-$label"
        $operation = Invoke-HarnessOperation -Name "spectrum_$label" -Fixture $Fixture `
            -Arguments @("--mode", "spectrum", "--proteowizard-home", $PortableRoot,
                "--input", $FixturePath, "--output-dir", $output, "--spectrum-index", "$index") `
            -SanitizedArguments @("--mode", "spectrum", "--proteowizard-home", "<portable-root>",
                "--input", $SanitizedFixture, "--output-dir", "<output-root>/$Fixture-spectrum-$label",
                "--spectrum-index", "$index") `
            -Account $Account -Password $Password -HarnessPath $HarnessPath -Environment $Environment `
            -Layout $Layout -OutputDirectory $output -AllowTypedFailure -Record
        $matrix.selectedSpectra += [ordered]@{
            label = $label
            index = $index
            previewInterpretation = $operation.previewInterpretation
            previewResultKind = $operation.previewResultKind
            previewErrorKind = $operation.previewErrorKind
            backendElapsedMs = $operation.backendElapsedMs
            parserElapsedMs = $operation.parserElapsedMs
            totalElapsedMs = $operation.launcherElapsedMs
            peakJobMemoryBytes = $operation.peakJobMemoryBytes
            outputBytes = if ($null -eq $operation.output) { $null }
                elseif ($operation.output.files.Count -ge 1) { $operation.output.files[0].bytes }
                else { 0L }
        }
        Remove-OperationDirectory $output
    }

    Write-Stage "unavailable_indices_$Fixture"
    foreach ($unavailable in @(
        [ordered]@{ label = "first_out_of_range"; index = "$spectrumCount" },
        [ordered]@{ label = "maximum_u64"; index = "18446744073709551615" }
    )) {
        $label = [string]$unavailable.label
        $output = New-OperationDirectory -Layout $Layout -Name "$Fixture-unavailable-$label"
        $operation = Invoke-HarnessOperation -Name "unavailable_$label" -Fixture $Fixture `
            -Arguments @("--mode", "spectrum", "--proteowizard-home", $PortableRoot,
                "--input", $FixturePath, "--output-dir", $output,
                "--spectrum-index", [string]$unavailable.index) `
            -SanitizedArguments @("--mode", "spectrum", "--proteowizard-home", "<portable-root>",
                "--input", $SanitizedFixture, "--output-dir", "<output-root>/$Fixture-unavailable-$label",
                "--spectrum-index", [string]$unavailable.index) `
            -Account $Account -Password $Password -HarnessPath $HarnessPath -Environment $Environment `
            -Layout $Layout -OutputDirectory $output -AllowTypedFailure -Record
        $matrix.unavailableIndices += [ordered]@{
            label = $label
            requestedIndex = [string]$unavailable.index
            previewInterpretation = $operation.previewInterpretation
            previewResultKind = $operation.previewResultKind
            previewErrorKind = $operation.previewErrorKind
            backendElapsedMs = $operation.backendElapsedMs
            totalElapsedMs = $operation.launcherElapsedMs
            generatedFileCount = if ($null -eq $operation.output) { $null } else { $operation.output.fileCount }
        }
        Remove-OperationDirectory $output
    }

    Write-Stage "repeated_navigation_$Fixture"
    $sequence = @(Get-NavigationSequence -SpectrumCount $spectrumCount)
    for ($pass = 1; $pass -le $NavigationPasses; $pass++) {
        $backendValues = [System.Collections.Generic.List[int64]]::new()
        $totalValues = [System.Collections.Generic.List[int64]]::new()
        $typedResults = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
        foreach ($index in $sequence) {
            $output = New-OperationDirectory -Layout $Layout -Name "$Fixture-nav-$pass-$index"
            $operation = Invoke-HarnessOperation -Name "navigation_pass_${pass}_$index" -Fixture $Fixture `
                -Arguments @("--mode", "spectrum", "--proteowizard-home", $PortableRoot,
                    "--input", $FixturePath, "--output-dir", $output, "--spectrum-index", "$index") `
                -SanitizedArguments @("--mode", "spectrum", "--proteowizard-home", "<portable-root>",
                    "--input", $SanitizedFixture, "--output-dir", "<output-root>/$Fixture-nav",
                    "--spectrum-index", "$index") `
                -Account $Account -Password $Password -HarnessPath $HarnessPath -Environment $Environment `
                -Layout $Layout -OutputDirectory $output -AllowTypedFailure
            if ($null -ne $operation.backendElapsedMs) { $backendValues.Add([int64]$operation.backendElapsedMs) }
            $totalValues.Add([int64]$operation.launcherElapsedMs)
            [void]$typedResults.Add([string]$operation.previewResultKind)
            Remove-OperationDirectory $output
        }
        $matrix.navigationPasses += [ordered]@{
            pass = $pass
            requestedIndexCount = $sequence.Count
            distinctTypedResultKinds = @($typedResults)
            backendLatency = Get-LatencyStatistics -Values $backendValues.ToArray()
            totalLatency = Get-LatencyStatistics -Values $totalValues.ToArray()
            warmthNote = "operating-system and filesystem warmth only; no MSCanvas cache exists in this slice"
        }
    }

    Write-Stage "convert_mzml_$Fixture"
    $conversionOutput = New-OperationDirectory -Layout $Layout -Name "$Fixture-convert-mzml"
    $conversion = Invoke-HarnessOperation -Name "convert_mzml" -Fixture $Fixture `
        -Arguments @("--mode", "convert", "--proteowizard-home", $PortableRoot,
            "--input", $FixturePath, "--output-dir", $conversionOutput, "--format", "mzML") `
        -SanitizedArguments @("--mode", "convert", "--proteowizard-home", "<portable-root>",
            "--input", $SanitizedFixture, "--output-dir", "<output-root>/$Fixture-convert-mzml",
            "--format", "mzML") `
        -Account $Account -Password $Password -HarnessPath $HarnessPath -Environment $Environment `
        -Layout $Layout -OutputDirectory $conversionOutput -TimeoutMilliseconds 1800000 -Record
    if ($conversion.backendExitCode -ne 0) { Stop-Evidence "conversion_backend_failed" }

    $facts = $conversion.harnessFacts
    $rustOutcome = Get-FactString $facts "conversion_integrity.outcome"
    $sourceStructure = Get-XmlStructure $FixturePath
    $independent = Test-ConversionOutput -Directory $conversionOutput -Format "mzML" `
        -InputStructure $sourceStructure
    $rustValid = $rustOutcome -ceq "valid"
    $independentValid = [string]$independent.status -ceq "valid"
    $countsAgree = $independentValid -and
        ([int64]$independent.spectrumCount -eq [int64](Get-FactInt64 $facts "conversion_output.spectrum_count")) -and
        ([int64]$independent.chromatogramCount -eq [int64](Get-FactInt64 $facts "conversion_output.chromatogram_count"))
    if ($rustValid -ne $independentValid) { Stop-Evidence "cross_check_disagreement" }
    if ($rustValid -and -not $countsAgree) { Stop-Evidence "cross_check_count_disagreement" }

    $matrix.conversion = [ordered]@{
        backendExitCode = $conversion.backendExitCode
        backendElapsedMs = $conversion.backendElapsedMs
        totalElapsedMs = $conversion.launcherElapsedMs
        peakJobMemoryBytes = $conversion.peakJobMemoryBytes
        sourceBytes = Get-FactInt64 $facts "conversion_source.bytes"
        sourceSha256 = Get-FactString $facts "conversion_source.sha256"
        sourceSpectrumCount = Get-FactInt64 $facts "conversion_source.spectrum_count"
        sourceChromatogramCount = Get-FactInt64 $facts "conversion_source.chromatogram_count"
        outputBytes = Get-FactInt64 $facts "conversion_output.bytes"
        outputSha256 = Get-FactString $facts "conversion_output.sha256"
        outputRoot = Get-FactString $facts "conversion_output.root"
        outputSpectrumCount = Get-FactInt64 $facts "conversion_output.spectrum_count"
        outputChromatogramCount = Get-FactInt64 $facts "conversion_output.chromatogram_count"
        rustComparison = Get-FactString $facts "conversion_integrity.comparison"
        rustOutcome = $rustOutcome
        rustFullyVerified = Get-FactBool $facts "conversion_integrity.fully_verified"
        rustVerifiedProperties = Get-FactString $facts "conversion_integrity.verified"
        rustUnverifiedProperties = Get-FactString $facts "conversion_integrity.unverified"
        rustAdvisoryObservations = Get-FactString $facts "conversion_integrity.advisory"
        independentStatus = [string]$independent.status
        independentSpectrumCount = $independent.spectrumCount
        independentChromatogramCount = $independent.chromatogramCount
        independentAllBinaryArraysZlib = $independent.allBinaryArraysZlib
        independentDtdProhibited = $independent.xmlReaderDtdProhibited
        independentResolverDisabled = $independent.xmlResolverDisabled
        crossCheckAgrees = $true
        equivalenceClaimed = $false
        losslessnessClaimed = $false
    }

    Write-Stage "post_conversion_reinspection_$Fixture"
    $convertedFiles = @(Get-ChildItem -LiteralPath $conversionOutput -File -Force)
    if ($convertedFiles.Count -ne 1) { Stop-Evidence "converted_output_not_single_file" }
    $convertedPath = $convertedFiles[0].FullName
    $convertedInspect = Invoke-HarnessOperation -Name "inspect_converted" -Fixture $Fixture `
        -Arguments @("--mode", "inspect", "--input", $convertedPath) `
        -SanitizedArguments @("--mode", "inspect", "--input", "<converted-output>") `
        -Account $Account -Password $Password -HarnessPath $HarnessPath -Environment $Environment `
        -Layout $Layout -Record
    $convertedFacts = $convertedInspect.harnessFacts
    $postOperations = @()
    foreach ($plan in @(
        [ordered]@{ name = "converted_run_summary"; mode = "run-summary"; extra = @() },
        [ordered]@{ name = "converted_spectrum_table"; mode = "spectrum-table"; extra = @() },
        [ordered]@{ name = "converted_spectrum_first"; mode = "spectrum"; extra = @("--spectrum-index", "0") }
    )) {
        $output = New-OperationDirectory -Layout $Layout -Name "$Fixture-$($plan.name)"
        $arguments = @("--mode", $plan.mode, "--proteowizard-home", $PortableRoot,
            "--input", $convertedPath, "--output-dir", $output) + $plan.extra
        $sanitized = @("--mode", $plan.mode, "--proteowizard-home", "<portable-root>",
            "--input", "<converted-output>", "--output-dir", "<output-root>/$Fixture-$($plan.name)") + $plan.extra
        $operation = Invoke-HarnessOperation -Name $plan.name -Fixture $Fixture `
            -Arguments $arguments -SanitizedArguments $sanitized -Account $Account -Password $Password `
            -HarnessPath $HarnessPath -Environment $Environment -Layout $Layout `
            -OutputDirectory $output -AllowTypedFailure -Record
        $postOperations += [ordered]@{
            name = $plan.name
            previewInterpretation = $operation.previewInterpretation
            previewResultKind = $operation.previewResultKind
            previewErrorKind = $operation.previewErrorKind
            backendElapsedMs = $operation.backendElapsedMs
            totalElapsedMs = $operation.launcherElapsedMs
        }
        Remove-OperationDirectory $output
    }
    $matrix.postConversion = [ordered]@{
        convertedRoot = Get-FactString $convertedFacts "inspect.root"
        convertedSpectrumCount = Get-FactInt64 $convertedFacts "inspect.observed_spectrum_count"
        convertedChromatogramCount = Get-FactInt64 $convertedFacts "inspect.observed_chromatogram_count"
        convertedMsLevelDistribution = Get-FactString $convertedFacts "inspect.ms_level_distribution"
        convertedParserElapsedMs = Get-FactInt64 $convertedFacts "inspect.parser_elapsed_ms"
        navigationOfConvertedResult = @($postOperations)
    }

    Remove-OperationDirectory $conversionOutput
    return $matrix
}

function Remove-OperationDirectory {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    $full = Assert-FullPathUnder -Candidate $LiteralPath -Parent $env:RUNNER_TEMP `
        -FailureCode "operation_directory_outside_runner_temp"
    if ([System.IO.Directory]::Exists($full)) {
        try { [System.IO.Directory]::Delete($full, $true) }
        catch { Stop-Evidence "operation_directory_cleanup_failed" }
    }
}

function Get-ForbiddenEvidencePatterns {
    return @(
        '(?i)(?<![A-Za-z0-9])[a-z]:[\\/]',
        '(?i)file:(?:[\\/]|\\[\\/])+',
        '(?i)\\\\[^<\s][^\\\s]*\\',
        '(?i)scientific\.stdout_base64',
        '(?i)GITHUB_',
        '(?i)ACTIONS_',
        '(?i)(github_pat_|gh[opsu]_|bearer\s+|authorization\s*[:=]|password\s*[:=]|credential\s*[:=])',
        '(?i)BBM_',
        '(?i)_calibrated\.mzML',
        '(?i)\bm/z\s*=',
        '(?i)intensity_array_values'
    )
}

function Assert-SanitizedEvidenceText {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string[]]$SensitiveValues
    )
    $patterns = @(Get-ForbiddenEvidencePatterns)
    foreach ($pattern in $patterns) {
        if ($Text -match $pattern) { Stop-Evidence "evidence_content_scan_failed" }
    }
    foreach ($value in $SensitiveValues) {
        if (-not [string]::IsNullOrWhiteSpace($value) -and $value.Length -ge 3 -and
            $Text.IndexOf($value, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            Stop-Evidence "evidence_identity_scan_failed"
        }
    }
}

function New-SanitizedEvidencePair {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Summary,
        [Parameter(Mandatory = $true)][string[]]$SensitiveValues
    )
    $json = $Summary | ConvertTo-Json -Depth 14
    $markdown = New-SummaryMarkdown $Summary
    Assert-SanitizedEvidenceText -Text ($json + "`n" + $markdown) -SensitiveValues $SensitiveValues
    return [ordered]@{ json = $json; markdown = $markdown }
}

function Assert-ExactSanitizedEvidencePair {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string[]]$SensitiveValues
    )
    if (-not [System.IO.Directory]::Exists($Root)) {
        Stop-Evidence "evidence_pair_root_missing"
    }
    $items = @(Get-ChildItem -LiteralPath $Root -Force)
    $files = @($items | Where-Object { -not $_.PSIsContainer })
    $names = @($files | Select-Object -ExpandProperty Name | Sort-Object)
    if ($items.Count -ne 2 -or $files.Count -ne 2 -or
        (Compare-Object -ReferenceObject @("summary.json", "summary.md") -DifferenceObject $names)) {
        Stop-Evidence "evidence_pair_allowlist_invalid"
    }
    if ($items | Where-Object {
        ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
    } | Select-Object -First 1) {
        Stop-Evidence "evidence_pair_reparse_point_present"
    }
    $strictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)
    try {
        $json = [System.IO.File]::ReadAllText((Join-Path $Root "summary.json"), $strictUtf8)
        $markdown = [System.IO.File]::ReadAllText((Join-Path $Root "summary.md"), $strictUtf8)
    }
    catch { Stop-Evidence "evidence_pair_read_failed" }
    Assert-SanitizedEvidenceText -Text ($json + "`n" + $markdown) -SensitiveValues $SensitiveValues
    try { $parsed = $json | ConvertFrom-Json -AsHashtable }
    catch { Stop-Evidence "evidence_pair_json_invalid" }
    if ($parsed -isnot [System.Collections.IDictionary]) {
        Stop-Evidence "evidence_pair_json_invalid"
    }
    try { $expectedMarkdown = New-SummaryMarkdown $parsed }
    catch { Stop-Evidence "evidence_pair_schema_invalid" }
    if ($markdown -cne $expectedMarkdown) {
        Stop-Evidence "evidence_pair_markdown_mismatch"
    }
    return $parsed
}

function Write-SanitizedEvidencePair {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Summary,
        [Parameter(Mandatory = $true)][string[]]$SensitiveValues
    )
    if ([string]::IsNullOrWhiteSpace($PublishRoot)) {
        Stop-Evidence "publish_root_missing"
    }
    $fullPublish = Assert-FullPathUnder -Candidate $PublishRoot -Parent $env:RUNNER_TEMP `
        -FailureCode "publish_root_outside_runner_temp"
    if ([System.IO.Path]::GetFileName($fullPublish) -ne "m0c-publish") {
        Stop-Evidence "publish_root_name_invalid"
    }
    if ([System.IO.Directory]::Exists($fullPublish) -or [System.IO.File]::Exists($fullPublish)) {
        Stop-Evidence "publish_root_preexisting"
    }

    $pair = New-SanitizedEvidencePair -Summary $Summary -SensitiveValues $SensitiveValues
    $stagingName = "m0c-publish-staging-" + [Guid]::NewGuid().ToString('N')
    $staging = Assert-FullPathUnder -Candidate (Join-Path $env:RUNNER_TEMP $stagingName) `
        -Parent $env:RUNNER_TEMP -FailureCode "publish_staging_outside_runner_temp"
    try {
        try { [System.IO.Directory]::CreateDirectory($staging) | Out-Null }
        catch { Stop-Evidence "publish_staging_creation_failed" }
        Protect-AdminOnlyPath -LiteralPath $staging -Directory `
            -FailureCode "publish_staging_directory_acl_failed"
        $jsonPath = Join-Path $staging "summary.json"
        $markdownPath = Join-Path $staging "summary.md"
        $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
        try {
            [System.IO.File]::WriteAllText($jsonPath, [string]$pair.json, $utf8)
            [System.IO.File]::WriteAllText($markdownPath, [string]$pair.markdown, $utf8)
        }
        catch { Stop-Evidence "publish_pair_write_failed" }
        Protect-AdminOnlyPath -LiteralPath $jsonPath -FailureCode "publish_json_acl_failed"
        Protect-AdminOnlyPath -LiteralPath $markdownPath -FailureCode "publish_markdown_acl_failed"
        Assert-AdminOnlyPath -LiteralPath $staging -Directory `
            -FailureCode "publish_staging_directory_acl_invalid"
        Assert-AdminOnlyPath -LiteralPath $jsonPath -FailureCode "publish_json_acl_invalid"
        Assert-AdminOnlyPath -LiteralPath $markdownPath -FailureCode "publish_markdown_acl_invalid"
        [void](Assert-ExactSanitizedEvidencePair -Root $staging -SensitiveValues $SensitiveValues)
        if ([System.IO.Directory]::Exists($fullPublish) -or [System.IO.File]::Exists($fullPublish)) {
            Stop-Evidence "publish_root_preexisting"
        }
        try { [System.IO.Directory]::Move($staging, $fullPublish) }
        catch { Stop-Evidence "publish_atomic_move_failed" }
        $staging = $null
    }
    finally {
        if (-not [string]::IsNullOrWhiteSpace($staging) -and
            [System.IO.Directory]::Exists($staging)) {
            try { [System.IO.Directory]::Delete($staging, $true) }
            catch { Stop-Evidence "publish_staging_cleanup_failed" }
        }
    }
}

function New-MinimalBlockedSummary {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Summary,
        [Parameter(Mandatory = $true)][string]$FullPublishCode
    )
    $sourceSha = [string]$Summary.sourceSha
    if ($sourceSha -notmatch '^[0-9a-fA-F]{40}$') {
        Stop-Evidence "fallback_source_sha_invalid"
    }
    $collectedAt = [string]$Summary.collectedAtUtc
    $parsedTimestamp = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse(
            $collectedAt,
            [System.Globalization.CultureInfo]::InvariantCulture,
            [System.Globalization.DateTimeStyles]::RoundtripKind,
            [ref]$parsedTimestamp
        )) {
        Stop-Evidence "fallback_timestamp_invalid"
    }

    $primaryStage = "publish_sanitized_evidence"
    $primaryCode = "full_summary_publish_failed"
    if ([string]$Summary.status -eq "blocked" -and
        $Summary.failure -is [System.Collections.IDictionary]) {
        $primaryStage = Get-StableEvidenceToken -Value ([string]$Summary.failure.stage) `
            -Fallback "publish_sanitized_evidence"
        $primaryCode = Get-StableEvidenceToken -Value ([string]$Summary.failure.code) `
            -Fallback "unexpected_orchestration_failure"
    }
    $safeFullPublishCode = Get-StableEvidenceToken -Value $FullPublishCode `
        -Fallback "unexpected_orchestration_failure"
    $archiveVerified = $false
    $fixtureVerified = $false
    try { $archiveVerified = $Summary.provenance.archive.verified -eq $true }
    catch { }
    try { $fixtureVerified = $Summary.provenance.fixture.verified -eq $true }
    catch { }

    return [ordered]@{
        schemaVersion = 1
        status = "blocked"
        sourceSha = $sourceSha.ToLowerInvariant()
        collectedAtUtc = $parsedTimestamp.ToUniversalTime().ToString(
            "O", [System.Globalization.CultureInfo]::InvariantCulture
        )
        runner = $null
        bundle = $null
        provenance = [ordered]@{
            archive = [ordered]@{ verified = $archiveVerified }
            fixture = [ordered]@{ verified = $fixtureVerified; vendorData = $false }
            executables = $null
            msiExecuted = $false
            localDevelopmentHostExecution = $false
        }
        isolation = [ordered]@{
            standardUserExecutionVerified = $false
            firewallRulesVerifiedBeforeExecution = $false
        }
        help = $null
        fixtureStructure = $null
        orchestrationSelfTests = $null
        operations = @()
        capabilityOutcomes = [ordered]@{
            vendorCoverage = "not_run_by_scope"
            cancellation = "not_measurable"
        }
        failure = [ordered]@{ stage = $primaryStage; code = $primaryCode }
        publication = [ordered]@{
            fullSummaryPublished = $false
            minimalBlockedFallbackPublished = $true
            fullSummaryFailureCode = $safeFullPublishCode
        }
    }
}

function Publish-SanitizedEvidence {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Summary,
        [Parameter(Mandatory = $true)][string[]]$SensitiveValues
    )
    try {
        Write-SanitizedEvidencePair -Summary $Summary -SensitiveValues $SensitiveValues
        return [ordered]@{ fullSummaryPublished = $true; fallbackPublished = $false }
    }
    catch {
        $fullPublishCode = Get-StableFailureCode $_
        Write-StableEvidenceFailure -Kind "publication" -Stage "publish_sanitized_evidence" `
            -Code $fullPublishCode
    }
    try {
        $fallback = New-MinimalBlockedSummary -Summary $Summary -FullPublishCode $fullPublishCode
        Write-SanitizedEvidencePair -Summary $fallback -SensitiveValues $SensitiveValues
    }
    catch {
        $fallbackCode = Get-StableFailureCode $_
        Write-StableEvidenceFailure -Kind "publication_fallback" -Stage "publish_sanitized_evidence" `
            -Code $fallbackCode
        Stop-Evidence $fallbackCode
    }
    return [ordered]@{ fullSummaryPublished = $false; fallbackPublished = $true }
}

function Write-CleanupAttestation {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Attestation,
        [Parameter(Mandatory = $true)][string[]]$SensitiveValues
    )
    $publishFull = Assert-FullPathUnder -Candidate $PublishRoot -Parent $env:RUNNER_TEMP `
        -FailureCode "cleanup_publish_outside_runner_temp"
    if ([System.IO.Path]::GetFileName($publishFull) -ne "m0c-publish") {
        Stop-Evidence "cleanup_publish_name_invalid"
    }
    $jsonPath = Join-Path $publishFull "summary.json"
    $markdownPath = Join-Path $publishFull "summary.md"
    if (-not [System.IO.File]::Exists($jsonPath) -or -not [System.IO.File]::Exists($markdownPath)) {
        Stop-Evidence "cleanup_publish_summary_missing"
    }
    $summary = Assert-ExactSanitizedEvidencePair -Root $publishFull -SensitiveValues $SensitiveValues
    $summary.teardown = $Attestation
    $pair = New-SanitizedEvidencePair -Summary $summary -SensitiveValues $SensitiveValues
    $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
    try {
        [System.IO.File]::WriteAllText($jsonPath, [string]$pair.json, $utf8)
        [System.IO.File]::WriteAllText($markdownPath, [string]$pair.markdown, $utf8)
    }
    catch { Stop-Evidence "cleanup_attestation_write_failed" }
    Assert-AdminOnlyPath -LiteralPath $publishFull -Directory `
        -FailureCode "cleanup_publish_directory_acl_invalid"
    Assert-AdminOnlyPath -LiteralPath $jsonPath -FailureCode "cleanup_json_acl_invalid"
    Assert-AdminOnlyPath -LiteralPath $markdownPath -FailureCode "cleanup_markdown_acl_invalid"
    [void](Assert-ExactSanitizedEvidencePair -Root $publishFull -SensitiveValues $SensitiveValues)
}

function Invoke-EvidencePublicationSelfTest {
    param([Parameter(Mandatory = $true)][string]$TempRoot)
    $root = Join-Path $TempRoot ("evidence-publication-selftest-" + [Guid]::NewGuid().ToString('N'))
    [System.IO.Directory]::CreateDirectory($root) | Out-Null
    $previousRunnerTemp = $env:RUNNER_TEMP
    $existingPublishRoot = Get-Variable -Scope Script -Name PublishRoot -ErrorAction SilentlyContinue
    $previousPublishRoot = if ($null -ne $existingPublishRoot) { $existingPublishRoot.Value } else { $null }
    try {
        $env:RUNNER_TEMP = $root
        $script:PublishRoot = Join-Path $root "m0c-publish"
        $sensitiveValues = @("m0c-sensitive-machine", "runneradmin")
        $summary = [ordered]@{
            schemaVersion = 1
            status = "blocked"
            sourceSha = ('0' * 40)
            collectedAtUtc = "2026-01-01T00:00:00.0000000+00:00"
            runner = $null
            bundle = $null
            provenance = [ordered]@{
                archive = [ordered]@{ verified = $true }
                fixture = [ordered]@{ verified = $true; vendorData = $false }
                executables = $null
                msiExecuted = $false
                localDevelopmentHostExecution = $false
            }
            isolation = [ordered]@{
                standardUserExecutionVerified = $false
                firewallRulesVerifiedBeforeExecution = $false
            }
            help = $null
            fixtureStructure = $null
            orchestrationSelfTests = $null
            operations = @()
            capabilityOutcomes = [ordered]@{
                vendorCoverage = "not_run_by_scope"
                cancellation = "not_measurable"
            }
            failure = [ordered]@{
                stage = "safe_archive_extraction"
                code = "archive_member_path_invalid"
            }
        }

        $safeResult = Publish-SanitizedEvidence -Summary $summary -SensitiveValues $sensitiveValues
        if (-not $safeResult.fullSummaryPublished -or $safeResult.fallbackPublished) {
            Stop-Evidence "publication_selftest_full_pair_failed"
        }
        $published = Assert-ExactSanitizedEvidencePair -Root $script:PublishRoot `
            -SensitiveValues $sensitiveValues
        if ($published.status -cne "blocked" -or
            $published.failure.stage -cne "safe_archive_extraction" -or
            $published.failure.code -cne "archive_member_path_invalid") {
            Stop-Evidence "publication_selftest_primary_failure_lost"
        }
        $attestation = [ordered]@{
            allRuntimeProcessesAbsent = $true
            firewallRulesAbsent = $true
            temporaryProfileAbsent = $true
            temporaryUserAbsent = $true
            remoteInteractiveDenyRightCleaned = $true
            runtimeRootAbsent = $true
            acquiredFixturesAbsent = $true
            generatedConversionOutputAbsent = $true
            privateStateRemoved = $true
            cleanupComplete = $true
            failureCode = $null
        }
        Write-CleanupAttestation -Attestation $attestation -SensitiveValues $sensitiveValues
        $attested = Assert-ExactSanitizedEvidencePair -Root $script:PublishRoot `
            -SensitiveValues $sensitiveValues
        if ($attested.status -cne "blocked" -or -not $attested.teardown.cleanupComplete -or
            $attested.failure.code -cne "archive_member_path_invalid") {
            Stop-Evidence "publication_selftest_attestation_roundtrip_failed"
        }
        [System.IO.Directory]::Delete($script:PublishRoot, $true)

        $unsafeSummary = $summary | ConvertTo-Json -Depth 10 | ConvertFrom-Json -AsHashtable
        $canary = 'D:\private\runneradmin\sample.raw'
        $unsafeSummary.help = $canary
        $captured = @(& {
            Publish-SanitizedEvidence -Summary $unsafeSummary -SensitiveValues $sensitiveValues
        } 6>&1)
        $fallbackResult = @($captured | Where-Object {
            $_ -is [System.Collections.IDictionary]
        } | Select-Object -Last 1)
        if ($fallbackResult.Count -ne 1 -or $fallbackResult[0].fullSummaryPublished -or
            -not $fallbackResult[0].fallbackPublished) {
            Stop-Evidence "publication_selftest_fallback_failed"
        }
        $stableLog = [string]::Join("`n", @($captured | Where-Object {
            $_ -isnot [System.Collections.IDictionary]
        } | ForEach-Object { [string]$_ }))
        if ($stableLog -notmatch '(?m)^M0C publication blocked stage=publish_sanitized_evidence code=evidence_content_scan_failed$' -or
            $stableLog.Contains($canary) -or $stableLog.Contains($root)) {
            Stop-Evidence "publication_selftest_stable_log_failed"
        }
        $fallback = Assert-ExactSanitizedEvidencePair -Root $script:PublishRoot `
            -SensitiveValues $sensitiveValues
        if ($fallback.status -cne "blocked" -or
            $fallback.failure.stage -cne "safe_archive_extraction" -or
            $fallback.failure.code -cne "archive_member_path_invalid" -or
            $fallback.publication.fullSummaryFailureCode -cne "evidence_content_scan_failed") {
            Stop-Evidence "publication_selftest_fallback_identity_failed"
        }
        $fallbackText = [System.IO.File]::ReadAllText((Join-Path $script:PublishRoot "summary.json")) +
            "`n" + [System.IO.File]::ReadAllText((Join-Path $script:PublishRoot "summary.md"))
        if ($fallbackText.Contains($canary) -or $fallbackText.Contains($root) -or
            $fallbackText.Contains("runneradmin")) {
            Stop-Evidence "publication_selftest_fallback_leak"
        }
        Write-CleanupAttestation -Attestation $attestation -SensitiveValues $sensitiveValues
        $fallbackAttested = Assert-ExactSanitizedEvidencePair -Root $script:PublishRoot `
            -SensitiveValues $sensitiveValues
        if (-not $fallbackAttested.teardown.cleanupComplete -or
            $fallbackAttested.publication.fullSummaryFailureCode -cne "evidence_content_scan_failed") {
            Stop-Evidence "publication_selftest_fallback_attestation_failed"
        }
        [System.IO.Directory]::Delete($script:PublishRoot, $true)

        [System.IO.Directory]::CreateDirectory($script:PublishRoot) | Out-Null
        $sentinel = Join-Path $script:PublishRoot "sentinel.txt"
        [System.IO.File]::WriteAllText($sentinel, "do-not-overwrite")
        $preexistingRejected = $false
        try { Write-SanitizedEvidencePair -Summary $summary -SensitiveValues $sensitiveValues }
        catch {
            $preexistingRejected = (Get-StableFailureCode $_) -eq "publish_root_preexisting"
        }
        if (-not $preexistingRejected -or
            [System.IO.File]::ReadAllText($sentinel) -cne "do-not-overwrite") {
            Stop-Evidence "publication_selftest_overwrite_guard_failed"
        }
        if ((Get-StableEvidenceToken -Value $canary -Fallback "unknown_stage") -cne "unknown_stage") {
            Stop-Evidence "publication_selftest_token_guard_failed"
        }
        [System.IO.Directory]::Delete($script:PublishRoot, $true)
        if (Get-ChildItem -LiteralPath $root -Directory -Filter "m0c-publish-staging-*" |
            Select-Object -First 1) {
            Stop-Evidence "publication_selftest_staging_residue"
        }
        return [ordered]@{
            passed = $true
            atomicPairVerified = $true
            blockedTeardownRoundTripVerified = $true
            unsafeFullSummaryFallbackVerified = $true
            stableLoggingVerified = $true
            overwriteGuardVerified = $true
        }
    }
    finally {
        if ($null -eq $previousRunnerTemp) { Remove-Item Env:RUNNER_TEMP -ErrorAction SilentlyContinue }
        else { $env:RUNNER_TEMP = $previousRunnerTemp }
        if ($null -ne $existingPublishRoot) { $script:PublishRoot = $previousPublishRoot }
        else { Remove-Variable -Scope Script -Name PublishRoot -ErrorAction SilentlyContinue }
        if ([System.IO.Directory]::Exists($root)) {
            [System.IO.Directory]::Delete($root, $true)
        }
    }
}

function Invoke-IsolationCleanup {
    if ([string]::IsNullOrWhiteSpace($StatePath) -or -not [System.IO.File]::Exists($StatePath)) {
        Write-Host "M0C cleanup private state was unavailable; teardown could not be attested."
        return 1
    }
    try {
        $stateFull = Assert-FullPathUnder -Candidate $StatePath -Parent $env:RUNNER_TEMP `
            -FailureCode "cleanup_state_outside_runner_temp"
        if ([System.IO.Path]::GetFileName($stateFull) -ne "m0c-state.json") {
            Stop-Evidence "cleanup_state_name_invalid"
        }
        $state = Get-Content -Raw -LiteralPath $stateFull | ConvertFrom-Json
    }
    catch {
        Write-Host "M0C cleanup could not validate its private state."
        return 1
    }

    $attestation = [ordered]@{
        allRuntimeProcessesAbsent = $false
        firewallRulesAbsent = $false
        temporaryProfileAbsent = $false
        temporaryUserAbsent = $false
        remoteInteractiveDenyRightCleaned = $false
        runtimeRootAbsent = $false
        acquiredFixturesAbsent = $false
        generatedConversionOutputAbsent = $false
        privateStateRemoved = $false
        cleanupComplete = $false
        failureCode = "cleanup_in_progress"
    }
    $sensitiveValues = @(@($env:COMPUTERNAME, $env:USERNAME, [string]$state.username) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $writeFailure = {
        param([string]$Code)
        $attestation.failureCode = $Code
        try { Write-CleanupAttestation -Attestation $attestation -SensitiveValues $sensitiveValues }
        catch { }
        Write-StableEvidenceFailure -Kind "cleanup" -Stage "teardown" -Code $Code
        return 1
    }

    $runtimeRoot = [string]$state.runtimeRoot
    try {
        $runtimeFull = Assert-FullPathUnder -Candidate $runtimeRoot -Parent $env:RUNNER_TEMP `
            -FailureCode "cleanup_runtime_outside_runner_temp"
        if (-not [System.IO.Path]::GetFileName($runtimeFull).StartsWith($RuntimePrefix, [System.StringComparison]::Ordinal)) {
            Stop-Evidence "cleanup_runtime_name_invalid"
        }
        $runtimePrefix = $runtimeFull.TrimEnd('\') + '\'
        $processes = @(Get-CimInstance -ClassName Win32_Process | Where-Object {
            -not [string]::IsNullOrWhiteSpace($_.ExecutablePath) -and
            $_.ExecutablePath.StartsWith($runtimePrefix, [System.StringComparison]::OrdinalIgnoreCase)
        })
        foreach ($process in $processes) {
            Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Milliseconds 500
        if (Get-CimInstance -ClassName Win32_Process | Where-Object {
            -not [string]::IsNullOrWhiteSpace($_.ExecutablePath) -and
            $_.ExecutablePath.StartsWith($runtimePrefix, [System.StringComparison]::OrdinalIgnoreCase)
        } | Select-Object -First 1) {
            Stop-Evidence "cleanup_runtime_process_remained"
        }
        $attestation.allRuntimeProcessesAbsent = $true
    }
    catch { return & $writeFailure "runtime_process_absence_unproven" }

    $sid = [string]$state.sid
    $temporaryUserCreated = [bool]$state.temporaryUserCreated
    if (-not $temporaryUserCreated -and -not [string]::IsNullOrWhiteSpace($sid)) {
        return & $writeFailure "temporary_user_state_inconsistent"
    }
    if ($temporaryUserCreated) {
        if ($sid -notmatch '^S-1-5-21-(?:\d+-){3}\d+$') {
            return & $writeFailure "temporary_sid_invalid"
        }
        try {
            $profiles = @(Get-CimInstance -ClassName Win32_UserProfile -Filter "SID='$sid'" -ErrorAction Stop)
            foreach ($profile in $profiles) { Remove-CimInstance -InputObject $profile -ErrorAction Stop }
            if (Get-CimInstance -ClassName Win32_UserProfile -Filter "SID='$sid'" -ErrorAction Stop |
                Select-Object -First 1) {
                Stop-Evidence "cleanup_profile_remained"
            }
            $attestation.temporaryProfileAbsent = $true
        }
        catch { return & $writeFailure "temporary_profile_removal_failed" }
    }
    else { $attestation.temporaryProfileAbsent = $true }

    $username = [string]$state.username
    if ($temporaryUserCreated) {
        if ($username -notmatch '^m0b_[0-9a-f]{10}$') { return & $writeFailure "temporary_username_invalid" }
        try {
            $existingUser = Get-LocalUser -Name $username -ErrorAction SilentlyContinue
            if ($null -ne $existingUser -and $existingUser.SID.Value -ne $sid) {
                Stop-Evidence "cleanup_user_sid_mismatch"
            }
            if ($null -ne $existingUser) {
                Remove-LocalUser -Name $username
            }
            if (Get-LocalUser -Name $username -ErrorAction SilentlyContinue) {
                Stop-Evidence "cleanup_user_remained"
            }
            $attestation.temporaryUserAbsent = $true
        }
        catch { return & $writeFailure "temporary_user_removal_failed" }
    }
    else { $attestation.temporaryUserAbsent = $true }

    if ($temporaryUserCreated -and $state.remoteInteractiveDenyApplied) {
        try {
            Add-NativeRuntimeTypes
            [MSCanvas.M0Evidence.LsaRights]::RemoveAccountRight($sid, $RemoteInteractiveDenyRight)
            if ([MSCanvas.M0Evidence.LsaRights]::HasAccountRight($sid, $RemoteInteractiveDenyRight)) {
                Stop-Evidence "cleanup_remote_deny_remained"
            }
            $attestation.remoteInteractiveDenyRightCleaned = $true
        }
        catch { return & $writeFailure "remote_logon_deny_cleanup_failed" }
    }
    else { $attestation.remoteInteractiveDenyRightCleaned = $true }

    try {
        foreach ($ruleName in @($state.firewallRules)) {
            if ([string]$ruleName -notmatch '^M0C-[0-9a-f]{32}-(msconvert|msaccess|harness)$') {
                Stop-Evidence "cleanup_firewall_rule_name_invalid"
            }
            $existing = Get-NetFirewallRule -Name ([string]$ruleName) -PolicyStore ActiveStore `
                -ErrorAction SilentlyContinue
            if ($null -ne $existing) {
                $existingRules = @($existing)
                if ($existingRules.Count -ne 1 -or
                    $existingRules[0].DisplayName -cne "MSCanvas disposable M0C outbound block" -or
                    [string]$existingRules[0].Direction -ne "Outbound" -or
                    [string]$existingRules[0].Action -ne "Block") {
                    Stop-Evidence "cleanup_firewall_rule_identity_invalid"
                }
                $application = $existingRules[0] | Get-NetFirewallApplicationFilter
                if ([string]::IsNullOrWhiteSpace($application.Program) -or
                    -not $application.Program.StartsWith($runtimePrefix, [StringComparison]::OrdinalIgnoreCase)) {
                    Stop-Evidence "cleanup_firewall_program_identity_invalid"
                }
                Remove-NetFirewallRule -Name ([string]$ruleName) -PolicyStore ActiveStore -ErrorAction Stop
            }
            if (Get-NetFirewallRule -Name ([string]$ruleName) -PolicyStore ActiveStore `
                -ErrorAction SilentlyContinue) {
                Stop-Evidence "cleanup_firewall_rule_remained"
            }
        }
        $attestation.firewallRulesAbsent = $true
    }
    catch { return & $writeFailure "firewall_rule_cleanup_failed" }

    try {
        if ([System.IO.Directory]::Exists($runtimeFull)) {
            $marker = Join-Path $runtimeFull $RuntimeMarker
            if (-not [System.IO.File]::Exists($marker)) {
                Stop-Evidence "cleanup_runtime_marker_missing"
            }
            [System.IO.Directory]::Delete($runtimeFull, $true)
        }
        if ([System.IO.Directory]::Exists($runtimeFull)) { Stop-Evidence "cleanup_runtime_remained" }
        $attestation.runtimeRootAbsent = $true
        # Both acquired fixtures and every generated conversion output live
        # inside the runtime root, so its verified absence answers for them.
        $attestation.acquiredFixturesAbsent = $true
        $attestation.generatedConversionOutputAbsent = $true
    }
    catch { return & $writeFailure "runtime_root_removal_failed" }
    # Persist the prospective all-true attestation while the private recovery
    # state still exists. Upload remains gated on this cleanup process exiting
    # successfully after the subsequent verified state deletion.
    $attestation.privateStateRemoved = $true
    $attestation.cleanupComplete = $true
    $attestation.failureCode = $null
    try { Write-CleanupAttestation -Attestation $attestation -SensitiveValues $sensitiveValues }
    catch {
        $attestationCode = Get-StableFailureCode $_
        Write-StableEvidenceFailure -Kind "cleanup_attestation" -Stage "teardown" `
            -Code $attestationCode
        $attestation.privateStateRemoved = $false
        $attestation.cleanupComplete = $false
        return & $writeFailure "cleanup_attestation_persist_failed"
    }
    try {
        [System.IO.File]::Delete($stateFull)
        if ([System.IO.File]::Exists($stateFull)) { Stop-Evidence "cleanup_state_remained" }
    }
    catch {
        $attestation.privateStateRemoved = $false
        $attestation.cleanupComplete = $false
        return & $writeFailure "private_state_removal_failed"
    }
    return 0
}

function New-OperationDirectory {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Layout,
        [Parameter(Mandatory = $true)][string]$Name
    )
    $script:OperationIndex++
    $safeName = $Name -replace '[^a-z0-9_-]', '_'
    $path = Join-Path $Layout.output ("{0:D2}-{1}" -f $script:OperationIndex, $safeName)
    if ([System.IO.Directory]::Exists($path)) { Stop-Evidence "operation_directory_collision" }
    [System.IO.Directory]::CreateDirectory($path) | Out-Null
    return $path
}

function Get-MsAccessAnalysisQueries {
    param([Parameter(Mandatory = $true)][string]$CompleteHelpText)
    $inAnalysis = $false
    $sawAnalysisHeading = $false
    $queries = [System.Collections.Generic.List[object]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($rawLine in ($CompleteHelpText -split "`r?`n")) {
        $line = $rawLine.TrimEnd("`r")
        $trimmed = $line.Trim()
        if ($trimmed.Equals("Analysis commands (used with -x/--exec):", [System.StringComparison]::Ordinal)) {
            $inAnalysis = $true
            $sawAnalysisHeading = $true
            continue
        }
        if ($inAnalysis -and $trimmed -eq "Examples:") { break }
        if ($inAnalysis -and $line -match '^  ([A-Za-z_][A-Za-z0-9_]*)(?:\s|$)') {
            $name = $Matches[1]
            if (-not $seen.Add($name)) { Stop-Evidence "msaccess_help_duplicate_query" }
            $queries.Add([ordered]@{ name = $name; signature = $trimmed })
        }
    }
    if (-not $sawAnalysisHeading) { Stop-Evidence "msaccess_help_analysis_section_missing" }
    foreach ($required in @("metadata", "run_summary", "spectrum_table", "binary", "tic")) {
        if (-not $seen.Contains($required)) { Stop-Evidence "msaccess_help_required_query_missing" }
    }
    if ($CompleteHelpText -notmatch '(?m)^msLevel <mslevels>\r?$') {
        Stop-Evidence "msaccess_help_mslevel_signature_missing"
    }
    return @($queries)
}

function Invoke-HelpCapture {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Account,
        [Parameter(Mandatory = $true)][System.Security.SecureString]$Password,
        [Parameter(Mandatory = $true)][System.Collections.Generic.IDictionary[string, string]]$Environment,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Layout,
        [Parameter(Mandatory = $true)][int]$ExpectedExitCode
    )
    $result = Invoke-SecureProcess -Account $Account -Password $Password -Application $Executable `
        -Arguments @("--help") -Environment $Environment -Layout $Layout -TimeoutMilliseconds 120000
    if ($result.TimedOut -or $result.StdoutTruncated -or $result.StderrTruncated -or
        $result.StdoutTotalBytes -ne $result.Stdout.Length -or
        $result.StderrTotalBytes -ne $result.Stderr.Length -or
        $result.ExitCode -ne $ExpectedExitCode -or
        ($result.StdoutTotalBytes + $result.StderrTotalBytes) -eq 0) {
        Stop-Evidence "${Label}_help_incomplete"
    }
    $evidence = [ordered]@{
        exitCode = $result.ExitCode
        expectedExitCode = $ExpectedExitCode
        elapsedMs = $result.ElapsedMilliseconds
        stdoutRetainedBytes = $result.Stdout.Length
        stderrRetainedBytes = $result.Stderr.Length
        stdoutTotalBytes = $result.StdoutTotalBytes
        stderrTotalBytes = $result.StderrTotalBytes
        stdoutSha256 = Get-Sha256OfBytes $result.Stdout
        stderrSha256 = Get-Sha256OfBytes $result.Stderr
        stdoutComplete = $true
        stderrComplete = $true
        rawOutputPersisted = $false
    }
    if ($Label -eq "msaccess") {
        $completeText = (Get-Utf8Text $result.Stdout) + "`n" + (Get-Utf8Text $result.Stderr)
        $queries = @(Get-MsAccessAnalysisQueries $completeText)
        $evidence.analysisQueries = $queries
        $evidence.capabilityMatrix = [ordered]@{
            validation = "complete_help_section_grammar_and_rust_capability_parser"
            options = @(
                [ordered]@{ name = "outdir"; argument = "required" },
                [ordered]@{ name = "exec"; argument = "required" },
                [ordered]@{ name = "filter"; argument = "required" }
            )
            spectrumFilters = @(
                [ordered]@{ name = "msLevel"; signature = "msLevel <mslevels>" }
            )
            analysisQueries = $queries
        }
        $bpcDeclared = $queries | Where-Object { $_.name -ceq "bpc" } | Select-Object -First 1
        $evidence.bpcQueryDeclared = $null -ne $bpcDeclared
        $evidence.bpcConclusion = if ($null -ne $bpcDeclared) {
            "literal_bpc_query_declared_not_executed"
        }
        else { "literal_bpc_query_absent_equivalent_unverified" }
    }
    else {
        $evidence.capabilityMatrix = [ordered]@{
            validation = "complete_help_section_grammar_and_rust_capability_parser"
            options = @(
                [ordered]@{ name = "outdir"; argument = "required" },
                [ordered]@{ name = "mzML"; argument = "none" },
                [ordered]@{ name = "mzXML"; argument = "none" },
                [ordered]@{ name = "zlib"; argument = "optional_boolean" }
            )
        }
    }
    return $evidence
}

function Invoke-EvidenceRun {
    if ([string]::IsNullOrWhiteSpace($StatePath) -or [string]::IsNullOrWhiteSpace($PublishRoot) -or
        [string]::IsNullOrWhiteSpace($BundleRoot)) {
        Stop-Evidence "required_run_argument_missing"
    }
    $stateFull = Assert-FullPathUnder -Candidate $StatePath -Parent $env:RUNNER_TEMP `
        -FailureCode "cleanup_state_outside_runner_temp"
    if ([System.IO.Path]::GetFileName($stateFull) -ne "m0c-state.json" -or [System.IO.File]::Exists($stateFull)) {
        Stop-Evidence "cleanup_state_invalid"
    }
    Assert-Bundle $BundleRoot
    Add-NativeRuntimeTypes

    $script:Summary.runner = Get-RunnerEvidence
    $script:Summary.bundle = [ordered]@{
        artifactId = $ExpectedArtifactId
        artifactServiceDigest = $ExpectedArtifactDigest.ToUpperInvariant()
        manifestSha256 = $ExpectedManifestSha.ToUpperInvariant()
        exactArtifactIdDownload = $true
        payloadManifestVerified = $true
        sourceCheckoutInRuntimeJob = $false
    }

    Write-Stage "prepare_isolated_layout"
    $runtimeRoot = Join-Path $env:RUNNER_TEMP ($RuntimePrefix + [Guid]::NewGuid().ToString('N'))
    $runtimeRoot = Assert-FullPathUnder -Candidate $runtimeRoot -Parent $env:RUNNER_TEMP `
        -FailureCode "runtime_root_outside_runner_temp"
    if ([System.IO.Directory]::Exists($runtimeRoot)) { Stop-Evidence "runtime_root_collision" }
    [System.IO.Directory]::CreateDirectory($runtimeRoot) | Out-Null
    $layout = @{
        root = $runtimeRoot
        tools = Join-Path $runtimeRoot "tools"
        harness = Join-Path $runtimeRoot "harness"
        fixture = Join-Path $runtimeRoot "fixture"
        output = Join-Path $runtimeRoot "output"
        evidence = Join-Path $runtimeRoot "evidence"
        temp = Join-Path $runtimeRoot "temp"
    }
    foreach ($name in @("tools", "harness", "fixture", "output", "evidence", "temp")) {
        [System.IO.Directory]::CreateDirectory($layout[$name]) | Out-Null
    }
    [System.IO.File]::WriteAllText((Join-Path $runtimeRoot $RuntimeMarker), "disposable-runtime")
    $state = @{
        schemaVersion = 1
        runtimeRoot = $runtimeRoot
        username = ""
        sid = ""
        temporaryUserCreated = $false
        remoteInteractiveDenyApplied = $false
        firewallRules = @()
    }
    Save-CleanupState $state

    Write-Stage "deterministic_orchestration_selftests"
    $script:Summary.orchestrationSelfTests = Invoke-OrchestrationSelfTests -TempRoot $layout.temp

    $archivePath = Join-Path $env:RUNNER_TEMP ("m0c-archive-" + [Guid]::NewGuid().ToString('N') + ".tar.bz2")
    $password = $null
    try {
        Write-Stage "verify_public_inputs"
        Invoke-ExactDownload -Uri $ArchiveUrl -Destination $archivePath -ExpectedBytes $ArchiveBytes `
            -ExpectedSha $ArchiveSha256 -FailurePrefix "archive"
        $fixturePath = Join-Path $layout.fixture "tiny.pwiz.1.1.mzML"
        Invoke-ExactDownload -Uri $FixtureUrl -Destination $fixturePath -ExpectedBytes $FixtureBytes `
            -ExpectedSha $FixtureSha256 -FailurePrefix "fixture"
        [System.IO.File]::WriteAllText(
            (Join-Path $layout.fixture "unsupported-open-input.txt"),
            "MSCanvas controlled unsupported open-format input",
            [System.Text.Encoding]::UTF8
        )
        $script:Summary.provenance.archive.verified = $true
        $script:Summary.provenance.fixture.verified = $true

        Write-Stage "verify_representative_provenance"
        [void](Assert-SufficientFreeDisk -LiteralPath $layout.fixture)
        $representativeProvenance = Assert-RepresentativeProvenance
        $representativePath = Join-Path $layout.fixture "representative.mzML"
        $measuredRepresentative = Invoke-MeasuredDownload -Uri ([uri]$RepresentativeUrl) `
            -Destination $representativePath -ExpectedBytes $RepresentativeBytes `
            -PinnedSha $RepresentativeSha256 -FailurePrefix "representative"
        $representativeProvenance.observedBytes = $RepresentativeBytes
        $representativeProvenance.sha256 = $measuredRepresentative
        $representativeProvenance.pinnedHashRequired = $true
        $representativeProvenance.payloadRetained = $false
        $representativeProvenance.payloadUploaded = $false
        $script:Summary.provenance.representative = $representativeProvenance

        Write-Stage "safe_archive_extraction"
        $tools = Expand-VerifiedArchive -ArchivePath $archivePath -ToolsDirectory $layout.tools
        [System.IO.File]::Delete($archivePath)
        $archivePath = $null
        $script:Summary.provenance.executables = [ordered]@{
            msconvertSha256 = $MsConvertSha256
            msaccessSha256 = $MsAccessSha256
            verifiedAfterExtraction = $true
            authenticodeStatus = "not_checked"
        }
        $script:RuntimeAliases = @(
            [ordered]@{ value = $fixturePath; alias = "<fixture>" },
            [ordered]@{ value = $representativePath; alias = $RepresentativeAlias },
            [ordered]@{ value = $layout.output; alias = "<output-root>" },
            [ordered]@{ value = $layout.temp; alias = "<runtime-temp>" },
            [ordered]@{ value = $tools.portableRoot; alias = "<portable-root>" }
        ) | Sort-Object { ([string]$_.value).Length } -Descending

        $harnessPath = Join-Path $layout.harness "m0_proteowizard_spike.exe"
        Copy-Item -LiteralPath (Join-Path $BundleRoot "m0_proteowizard_spike.exe") -Destination $harnessPath
        Write-Stage "protect_runtime_inputs"
        Protect-AdminOnlyPath -LiteralPath $BundleRoot -Directory `
            -FailureCode "bundle_root_acl_protection_failed"
        Assert-AdminOnlyPath -LiteralPath $BundleRoot -Directory `
            -FailureCode "bundle_root_acl_invalid"
        if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_WORKSPACE) -and
            [System.IO.Directory]::Exists($env:GITHUB_WORKSPACE)) {
            Protect-AdminOnlyPath -LiteralPath $env:GITHUB_WORKSPACE -Directory `
                -FailureCode "runner_workspace_acl_protection_failed"
            Assert-AdminOnlyPath -LiteralPath $env:GITHUB_WORKSPACE -Directory `
                -FailureCode "runner_workspace_acl_invalid"
        }

        Write-Stage "create_standard_user"
        $password = New-RandomSecurePassword
        $account = New-RuntimeAccount -State $state -Password $password
        $readonlyAuditCount = Set-AndVerifyRuntimeAcls -Layout $layout -TemporarySid $account.sid

        Write-Stage "install_exact_firewall_blocks"
        $ruleNonce = [Guid]::NewGuid().ToString('N')
        Write-Stage "install_firewall_block_msconvert"
        Add-VerifiedFirewallRule -RuleName "M0C-$ruleNonce-msconvert" -ProgramPath $tools.msconvert -State $state
        Write-Stage "install_firewall_block_msaccess"
        Add-VerifiedFirewallRule -RuleName "M0C-$ruleNonce-msaccess" -ProgramPath $tools.msaccess -State $state
        Write-Stage "install_firewall_block_harness"
        Add-VerifiedFirewallRule -RuleName "M0C-$ruleNonce-harness" -ProgramPath $harnessPath -State $state
        Write-Stage "verify_active_firewall_profiles"
        $activeFirewallProfiles = @(Assert-FirewallEnforcement)
        $environment = New-MinimalEnvironment -Layout $layout -Account $account `
            -PortableRoot $tools.portableRoot

        Write-Stage "prove_standard_user_runtime"
        $proof = Invoke-SecureProcess -Account $account -Password $password -Application $harnessPath `
            -Arguments @("--mode", "runtime-proof", "--runtime-root", $layout.root,
                "--proteowizard-home", $tools.portableRoot) `
            -Environment $environment -Layout $layout -TimeoutMilliseconds 120000
        if ($proof.ExitCode -ne 0 -or $proof.TimedOut -or $proof.StdoutTruncated -or $proof.StderrTruncated) {
            Stop-Evidence "runtime_proof_failed"
        }
        $proofFacts = ConvertFrom-HarnessFacts (Get-Utf8Text $proof.Stdout)
        $requiredProofs = @(
            "runtime_proof.layout",
            "runtime_proof.environment_keys_exact",
            "runtime_proof.sensitive_environment_absent",
            "runtime_proof.temp_tmp_scoped",
            "runtime_proof.path_scoped",
            "runtime_proof.readonly_directories_enforced",
            "runtime_proof.writable_directories_enforced",
            "runtime_proof.cleanup_complete"
        )
        foreach ($key in $requiredProofs) {
            if (-not $proofFacts.Contains($key) -or $proofFacts[$key] -ne "true") {
                Stop-Evidence "runtime_proof_fact_missing"
            }
        }
        $script:Summary.isolation = [ordered]@{
            standardUserExecutionVerified = $proof.UserSidVerified
            administratorsGroupEnabled = $proof.AdministratorsGroupEnabled
            elevated = $proof.Elevated
            integrityRid = $proof.IntegrityRid
            mediumOrLowerIntegrity = $proof.IntegrityRid -le 0x2000
            jobAssignedBeforeResume = $proof.JobAssignedBeforeResume
            jobKillOnClose = $true
            loadUserProfile = $proof.LoadUserProfile
            remoteInteractiveLogonDenied = $true
            administratorsAndRemoteDesktopGroupsAbsent = $true
            explicitEnvironmentKeys = @("SystemRoot", "WINDIR", "TEMP", "TMP", "PATH")
            backendEnvironmentReclearedByHarness = $true
            sensitiveRunnerEnvironmentAbsentFromChild = $true
            readonlyAclProof = $true
            recursiveReadonlyAclItemCount = $readonlyAuditCount
            writableAclProof = $true
            bundleAndWorkspaceDaclProtected = $true
            exactPathOutboundBlockRuleCount = 3
            firewallRulesVerifiedBeforeExecution = $true
            firewallServiceRunning = $true
            activeFirewallProfilesEnabled = $true
            activeFirewallProfileCategories = $activeFirewallProfiles
            plaintextPasswordWrittenByScript = $false
            credentialFileCreatedByScript = $false
            passwordVariableUsesSecureString = $true
            unmanagedPasswordBufferZeroFreedByLauncher = $true
        }

        Write-Stage "capture_msconvert_help"
        $msconvertHelp = Invoke-HelpCapture -Label "msconvert" -Executable $tools.msconvert `
            -Account $account -Password $password -Environment $environment -Layout $layout `
            -ExpectedExitCode 0
        Write-Stage "capture_msaccess_help"
        $msaccessHelp = Invoke-HelpCapture -Label "msaccess" -Executable $tools.msaccess `
            -Account $account -Password $password -Environment $environment -Layout $layout `
            -ExpectedExitCode 1
        Write-Stage "probe_executable_identity"
        $probe = Invoke-SecureProcess -Account $account -Password $password -Application $harnessPath `
            -Arguments @("--mode", "probe", "--proteowizard-home", $tools.portableRoot) `
            -Environment $environment -Layout $layout -TimeoutMilliseconds 180000
        if ($probe.ExitCode -ne 0 -or $probe.TimedOut -or $probe.StdoutTruncated -or $probe.StderrTruncated) {
            Stop-Evidence "identity_probe_failed"
        }
        $probeFacts = ConvertFrom-HarnessFacts (Get-Utf8Text $probe.Stdout)
        foreach ($key in @(
            "discovery.availability",
            "discovery.same_installation",
            "discovery.release",
            "discovery.build_date",
            "discovery.msconvert.reported_release",
            "discovery.msconvert.release",
            "discovery.msconvert.source_revision",
            "discovery.msconvert.build_date",
            "discovery.msaccess.reported_release",
            "discovery.msaccess.release",
            "discovery.msaccess.source_revision",
            "discovery.msaccess.build_date",
            "discovery.msconvert.probe.stdout_truncated",
            "discovery.msconvert.probe.stderr_truncated",
            "discovery.msaccess.probe.stdout_truncated",
            "discovery.msaccess.probe.stderr_truncated"
        )) {
            if (-not $probeFacts.Contains($key)) { Stop-Evidence "identity_probe_fact_missing" }
        }
        if ($probeFacts["discovery.availability"] -ne "Available" -or
            $probeFacts["discovery.same_installation"] -ne "true" -or
            $probeFacts["discovery.release"] -ne $ExpectedRelease -or
            $probeFacts["discovery.build_date"] -eq "unavailable" -or
            $probeFacts["discovery.msconvert.reported_release"] -ne "3.0.26204 (a09eea9)" -or
            $probeFacts["discovery.msconvert.release"] -ne $ExpectedRelease -or
            $probeFacts["discovery.msconvert.source_revision"] -ne "a09eea9" -or
            $probeFacts["discovery.msconvert.build_date"] -eq "unavailable" -or
            $probeFacts["discovery.msaccess.reported_release"] -ne $ExpectedRelease -or
            $probeFacts["discovery.msaccess.release"] -ne $ExpectedRelease -or
            $probeFacts["discovery.msaccess.source_revision"] -notin @("unavailable", "a09eea9") -or
            $probeFacts["discovery.msaccess.build_date"] -eq "unavailable" -or
            $probeFacts["discovery.msconvert.probe.stdout_truncated"] -ne "false" -or
            $probeFacts["discovery.msconvert.probe.stderr_truncated"] -ne "false" -or
            $probeFacts["discovery.msaccess.probe.stdout_truncated"] -ne "false" -or
            $probeFacts["discovery.msaccess.probe.stderr_truncated"] -ne "false") {
            Stop-Evidence "identity_or_help_contract_mismatch"
        }
        $script:Summary.help = [ordered]@{
            msconvert = $msconvertHelp
            msaccess = $msaccessHelp
            compatibleToolPair = $true
            msconvertIdentity = [ordered]@{
                reportedRelease = $probeFacts["discovery.msconvert.reported_release"]
                normalizedRelease = $probeFacts["discovery.msconvert.release"]
                sourceRevision = $probeFacts["discovery.msconvert.source_revision"]
                buildDate = $probeFacts["discovery.msconvert.build_date"]
            }
            msaccessIdentity = [ordered]@{
                reportedRelease = $probeFacts["discovery.msaccess.reported_release"]
                normalizedRelease = $probeFacts["discovery.msaccess.release"]
                sourceRevision = $probeFacts["discovery.msaccess.source_revision"]
                buildDate = $probeFacts["discovery.msaccess.build_date"]
            }
            advertisedReleaseMatched = $true
            advertisedBuildCommit = "a09eea9"
            completeHelpUsedForGrammarValidation = $true
            rawHelpPersisted = $false
        }

        Write-Stage "measure_navigation_and_scale_matrix"
        $script:OperationIndex = 0
        $matrices = @()
        $matrices += Invoke-FixtureMatrix -Fixture "tiny_control" -FixturePath $fixturePath `
            -SanitizedFixture "<fixture>" -Account $account -Password $password `
            -HarnessPath $harnessPath -Environment $environment -Layout $layout `
            -PortableRoot $tools.portableRoot
        $matrices += Invoke-FixtureMatrix -Fixture "representative" -FixturePath $representativePath `
            -SanitizedFixture $RepresentativeAlias -Account $account -Password $password `
            -HarnessPath $harnessPath -Environment $environment -Layout $layout `
            -PortableRoot $tools.portableRoot
        $script:Summary.matrices = @($matrices)

        Write-Stage "revalidate_sources_after_matrix"
        $tinyFinal = Get-Item -LiteralPath $fixturePath
        if ([int64]$tinyFinal.Length -ne $FixtureBytes -or
            (Get-UpperSha256 $fixturePath) -cne $FixtureSha256) {
            Stop-Evidence "control_fixture_changed_during_measurement"
        }
        $representativeFinal = Get-Item -LiteralPath $representativePath
        if ([int64]$representativeFinal.Length -ne $RepresentativeBytes -or
            (Get-UpperSha256 $representativePath) -cne $RepresentativeSha256.ToUpperInvariant()) {
            Stop-Evidence "representative_fixture_changed_during_measurement"
        }
        $script:Summary.provenance.fixture.sourceUnchangedAfterMatrix = $true
        $script:Summary.provenance.representative.sourceUnchangedAfterMatrix = $true

        $script:Summary.capabilityOutcomes = [ordered]@{
            vendorCoverage = "not_run_by_scope"
            cancellation = "not_measurable"
            mzXmlConversion = "not_run_gated_before_planning"
            bpc = "not_run_by_scope"
            alternateLocale = "not_run_by_scope"
            previewCache = "not_implemented_in_this_slice"
            performancePosture = "advisory_single_observation_on_shared_hosted_runner"
        }
        $script:Summary.status = "completed"
        $script:Summary.failure = $null
        Write-Stage "evidence_complete"
    }
    finally {
        if ($null -ne $password) { $password.Dispose() }
        if (-not [string]::IsNullOrWhiteSpace($archivePath) -and [System.IO.File]::Exists($archivePath)) {
            [System.IO.File]::Delete($archivePath)
        }
    }
}

# Run A establishes the immutable representative identity and nothing else. No
# ProteoWizard binary is downloaded or executed, and no measurement is reported.
function Invoke-AttestationRun {
    if ([string]::IsNullOrWhiteSpace($StatePath) -or [string]::IsNullOrWhiteSpace($PublishRoot)) {
        Stop-Evidence "required_run_argument_missing"
    }
    $stateFull = Assert-FullPathUnder -Candidate $StatePath -Parent $env:RUNNER_TEMP `
        -FailureCode "cleanup_state_outside_runner_temp"
    if ([System.IO.Path]::GetFileName($stateFull) -ne "m0c-state.json" -or
        [System.IO.File]::Exists($stateFull)) {
        Stop-Evidence "cleanup_state_invalid"
    }
    $script:Summary.runner = Get-RunnerEvidence

    Write-Stage "prepare_attestation_layout"
    $runtimeRoot = Join-Path $env:RUNNER_TEMP ($RuntimePrefix + [Guid]::NewGuid().ToString('N'))
    $runtimeRoot = Assert-FullPathUnder -Candidate $runtimeRoot -Parent $env:RUNNER_TEMP `
        -FailureCode "runtime_root_outside_runner_temp"
    if ([System.IO.Directory]::Exists($runtimeRoot)) { Stop-Evidence "runtime_root_collision" }
    [System.IO.Directory]::CreateDirectory($runtimeRoot) | Out-Null
    $fixtureRoot = Join-Path $runtimeRoot "fixture"
    [System.IO.Directory]::CreateDirectory($fixtureRoot) | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $runtimeRoot $RuntimeMarker), "disposable-runtime")
    Save-CleanupState @{
        schemaVersion = 1
        runtimeRoot = $runtimeRoot
        username = ""
        sid = ""
        temporaryUserCreated = $false
        remoteInteractiveDenyApplied = $false
        firewallRules = @()
    }
    $freeBytes = Assert-SufficientFreeDisk -LiteralPath $runtimeRoot

    Write-Stage "verify_representative_provenance"
    $provenance = Assert-RepresentativeProvenance

    Write-Stage "acquire_representative_fixture"
    $representativePath = Join-Path $fixtureRoot "representative.mzML"
    $measured = Invoke-MeasuredDownload -Uri ([uri]$RepresentativeUrl) `
        -Destination $representativePath -ExpectedBytes $RepresentativeBytes `
        -PinnedSha "" -FailurePrefix "representative"
    $observedBytes = [int64](Get-Item -LiteralPath $representativePath).Length

    Write-Stage "discard_representative_payload"
    [System.IO.File]::Delete($representativePath)
    if ([System.IO.File]::Exists($representativePath)) {
        Stop-Evidence "representative_payload_not_discarded"
    }

    $provenance.observedBytes = $observedBytes
    $provenance.sha256 = $measured
    $provenance.payloadRetained = $false
    $provenance.payloadUploaded = $false
    $script:Summary.provenance.representative = $provenance
    $script:Summary.attestation = [ordered]@{
        stage = "run_a_acquire_and_attest"
        proteoWizardDownloaded = $false
        proteoWizardExecuted = $false
        performanceMeasured = $false
        freeDiskBytesObserved = $freeBytes
    }
    $script:Summary.status = "completed"
    $script:Summary.failure = $null
    Write-Stage "attestation_complete"
}

if ($Mode -eq "SelfTest") {
    $selfTestBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $selfTestRoot = Join-Path $selfTestBase ("mscanvas-m0c-selftest-" + [Guid]::NewGuid().ToString('N'))
    $selfTestFull = [System.IO.Path]::GetFullPath($selfTestRoot)
    if (-not $selfTestFull.StartsWith($selfTestBase, [StringComparison]::OrdinalIgnoreCase)) {
        Stop-Evidence "selftest_temp_containment_invalid"
    }
    [System.IO.Directory]::CreateDirectory($selfTestFull) | Out-Null
    $selfTestExitCode = 0
    try {
        Invoke-OrchestrationSelfTests -TempRoot $selfTestFull | ConvertTo-Json -Depth 8
    }
    catch {
        $selfTestExitCode = 1
        Write-StableEvidenceFailure -Kind "run" -Stage "deterministic_orchestration_selftests" `
            -Code (Get-StableFailureCode $_)
    }
    finally {
        if ([System.IO.Directory]::Exists($selfTestFull)) {
            try { [System.IO.Directory]::Delete($selfTestFull, $true) }
            catch {
                $selfTestExitCode = 1
                Write-StableEvidenceFailure -Kind "run" -Stage "deterministic_orchestration_selftests" `
                    -Code "selftest_cleanup_failed"
            }
        }
    }
    exit $selfTestExitCode
}

if ($Mode -eq "Cleanup") {
    exit (Invoke-IsolationCleanup)
}

if ($Mode -eq "RunB" -and $RepresentativeSha256 -notmatch '^[0-9a-fA-F]{64}$') {
    Write-StableEvidenceFailure -Kind "run" -Stage "initialize" -Code "representative_hash_not_pinned"
    exit 1
}

$script:CurrentStage = "initialize"
$script:Summary = [ordered]@{
    schemaVersion = 1
    status = "running"
    stage = $Mode
    sourceSha = $ExpectedSourceSha
    collectedAtUtc = [DateTime]::UtcNow.ToString("O", [System.Globalization.CultureInfo]::InvariantCulture)
    runner = $null
    bundle = $null
    provenance = [ordered]@{
        archive = [ordered]@{
            url = $ArchiveUrl
            expectedBytes = $ArchiveBytes
            expectedSha256 = $ArchiveSha256
            verified = $false
        }
        fixture = [ordered]@{
            url = $FixtureUrl
            expectedBytes = $FixtureBytes
            expectedSha256 = $FixtureSha256
            verified = $false
            vendorData = $false
        }
        representative = $null
        executables = $null
        msiExecuted = $false
        localDevelopmentHostExecution = $false
    }
    isolation = [ordered]@{
        standardUserExecutionVerified = $false
        firewallRulesVerifiedBeforeExecution = $false
    }
    help = $null
    orchestrationSelfTests = $null
    operations = @()
    matrices = @()
    attestation = $null
    capabilityOutcomes = [ordered]@{
        vendorCoverage = "not_run_by_scope"
        cancellation = "not_measurable"
    }
    failure = $null
}

$runExitCode = 0
try {
    if ($Mode -eq "RunA") { Invoke-AttestationRun }
    else { Invoke-EvidenceRun }
}
catch {
    $runExitCode = 1
    $script:Summary.status = "blocked"
    $stableStage = Get-StableEvidenceToken -Value ([string]$script:CurrentStage) `
        -Fallback "unknown_stage"
    $stableCode = Get-StableFailureCode $_
    $script:Summary.failure = [ordered]@{
        stage = $stableStage
        code = $stableCode
    }
    Write-StableEvidenceFailure -Kind "run" -Stage $stableStage -Code $stableCode
}

$sensitiveValues = @($env:COMPUTERNAME, $env:USERNAME)
if (-not [string]::IsNullOrWhiteSpace($StatePath) -and [System.IO.File]::Exists($StatePath)) {
    try {
        $privateState = Get-Content -Raw -LiteralPath $StatePath | ConvertFrom-Json
        $sensitiveValues += [string]$privateState.username
    }
    catch { $runExitCode = 1 }
}
# A stage that creates no temporary account leaves an empty user name, which is
# not a value to redact and cannot be bound to the scanner.
$sensitiveValues = @($sensitiveValues | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
try {
    $publication = Publish-SanitizedEvidence -Summary $script:Summary -SensitiveValues $sensitiveValues
    if (-not $publication.fullSummaryPublished) { $runExitCode = 1 }
}
catch {
    $runExitCode = 1
}
exit $runExitCode
