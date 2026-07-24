[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Run", "Cleanup", "SelfTest")]
    [string]$Mode,

    [string]$BundleRoot,
    [string]$StatePath,
    [string]$PublishRoot,
    [string]$ExpectedArtifactId,
    [string]$ExpectedArtifactDigest,
    [string]$ExpectedSourceSha,
    [string]$ExpectedManifestSha
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
$ExpectedArchiveMembers = 265
$ExpectedExtractedItems = 264
$ExpectedRelease = "3.0.26204"
$RemoteInteractiveDenyRight = "SeDenyRemoteInteractiveLogonRight"
$RuntimePrefix = "mscanvas-m0b-"
$RuntimeMarker = ".mscanvas-m0b-runtime"
$MaximumCaptureBytes = 8MB

function Stop-Evidence {
    param([Parameter(Mandatory = $true)][string]$Code)
    throw "M0B:$Code"
}

function Get-StableFailureCode {
    param([Parameter(Mandatory = $true)][System.Management.Automation.ErrorRecord]$ErrorRecord)
    if ($ErrorRecord.Exception.Message -match '^M0B:([a-z0-9_]+)$') {
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
    Write-Host "M0B $Kind blocked stage=$safeStage code=$safeCode"
}

function Write-Stage {
    param([Parameter(Mandatory = $true)][string]$Name)
    $script:CurrentStage = $Name
    Write-Host "M0B evidence stage: $Name"
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

    $expectedNames = @("bundle-manifest.json", "m0_proteowizard_evidence.ps1", "m0_proteowizard_spike.exe")
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
    $expectedPayloadNames = @("m0_proteowizard_evidence.ps1", "m0_proteowizard_spike.exe")
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
        -Description "Disposable MSCanvas M0B evidence account"
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
        [string]$rule.DisplayName -cne "MSCanvas disposable M0B outbound block") {
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
    New-NetFirewallRule -Name $RuleName -DisplayName "MSCanvas disposable M0B outbound block" `
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
        '^process\.(exit_code|termination|elapsed_ms|stdout_captured_bytes|stderr_captured_bytes|stdout_total_bytes|stderr_total_bytes|stdout_truncated|stderr_truncated|max_active_processes|final_active_processes|output_directory_changed|partial_output_present)$',
        '^failure\.(kind|retryability|partial_output_present)$',
        '^conversion_output\.(filesystem_validation|hash_validation|sha256|xml_validation|bytes|source_basename_preserved)$'
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

function Get-ObservedOrUnverified {
    param($Value)
    if ($null -eq $Value -or ([string]$Value).Length -eq 0) {
        return [ordered]@{ status = "D_not_observed"; value = $null }
    }
    return [ordered]@{ status = "observed"; value = $Value }
}

function Get-UniquePrivatePayloadFact {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$ValuePattern
    )
    $pattern = '(?m)^' + [regex]::Escape($Name) + '=(' + $ValuePattern + ')\r?$'
    $matches = [regex]::Matches($Text, $pattern)
    if ($matches.Count -ne 1) { Stop-Evidence "scientific_stdout_payload_fact_invalid" }
    return $matches[0].Groups[1].Value
}

function Get-PrivateScientificStdoutPayload {
    param([Parameter(Mandatory = $true)][string]$HarnessStdout)
    $status = Get-UniquePrivatePayloadFact -Text $HarnessStdout `
        -Name "scientific.stdout_payload_status" `
        -ValuePattern '(?:complete|omitted_size_limit|invalid_utf8|incomplete_capture)'
    $sha256 = Get-UniquePrivatePayloadFact -Text $HarnessStdout `
        -Name "scientific.stdout_sha256" -ValuePattern '(?:[A-Fa-f0-9]{64}|unavailable)'
    $byteText = Get-UniquePrivatePayloadFact -Text $HarnessStdout `
        -Name "scientific.stdout_bytes" -ValuePattern '\d+'
    $chunkCountText = Get-UniquePrivatePayloadFact -Text $HarnessStdout `
        -Name "scientific.stdout_base64_chunk_count" -ValuePattern '\d+'
    $byteCount = 0L
    $chunkCount = 0
    if (-not [int64]::TryParse($byteText, [Globalization.NumberStyles]::None,
            [Globalization.CultureInfo]::InvariantCulture, [ref]$byteCount) -or $byteCount -lt 0 -or
        -not [int]::TryParse($chunkCountText, [Globalization.NumberStyles]::None,
            [Globalization.CultureInfo]::InvariantCulture, [ref]$chunkCount) -or
        $chunkCount -lt 0 -or $chunkCount -gt 2048) {
        Stop-Evidence "scientific_stdout_payload_size_invalid"
    }

    $chunkMatches = [regex]::Matches(
        $HarnessStdout,
        '(?m)^scientific\.stdout_base64\[(\d+)\]=([^\r\n]*)\r?$'
    )
    if ($chunkMatches.Count -ne $chunkCount) {
        Stop-Evidence "scientific_stdout_payload_chunk_count_invalid"
    }
    if ($status -ne "complete") {
        if ($chunkCount -ne 0) { Stop-Evidence "scientific_stdout_payload_unexpected_chunks" }
        if ($status -eq "incomplete_capture" -and $sha256 -ne "unavailable") {
            Stop-Evidence "scientific_stdout_payload_incomplete_hash_invalid"
        }
        if ($status -ne "incomplete_capture" -and $sha256 -notmatch '^[A-Fa-f0-9]{64}$') {
            Stop-Evidence "scientific_stdout_payload_hash_invalid"
        }
        return [ordered]@{
            status = $status
            bytes = $byteCount
            sha256 = $sha256.ToUpperInvariant()
            text = $null
        }
    }
    if ($sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or $byteCount -gt 256KB) {
        Stop-Evidence "scientific_stdout_payload_complete_metadata_invalid"
    }

    $chunks = [string[]]::new($chunkCount)
    foreach ($match in $chunkMatches) {
        $index = 0
        if (-not [int]::TryParse($match.Groups[1].Value, [Globalization.NumberStyles]::None,
                [Globalization.CultureInfo]::InvariantCulture, [ref]$index) -or
            $index -lt 0 -or $index -ge $chunkCount -or $null -ne $chunks[$index]) {
            Stop-Evidence "scientific_stdout_payload_chunk_index_invalid"
        }
        $chunk = $match.Groups[2].Value
        if ($chunk -notmatch '^[A-Za-z0-9+/]*={0,2}$' -or $chunk.Length -gt 256 -or
            ($index -lt ($chunkCount - 1) -and $chunk.Length -ne 256) -or
            ($chunkCount -gt 0 -and $chunk.Length -eq 0)) {
            Stop-Evidence "scientific_stdout_payload_chunk_encoding_invalid"
        }
        $chunks[$index] = $chunk
    }
    if ($chunks | Where-Object { $null -eq $_ }) {
        Stop-Evidence "scientific_stdout_payload_chunk_gap"
    }
    $base64 = [string]::Concat($chunks)
    if (($base64.Length % 4) -ne 0) { Stop-Evidence "scientific_stdout_payload_base64_length_invalid" }
    try { $bytes = [Convert]::FromBase64String($base64) }
    catch { Stop-Evidence "scientific_stdout_payload_base64_invalid" }
    if ($bytes.LongLength -ne $byteCount -or
        (Get-Sha256OfBytes $bytes) -ne $sha256.ToUpperInvariant()) {
        Stop-Evidence "scientific_stdout_payload_integrity_invalid"
    }
    try {
        $strictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)
        $decoded = $strictUtf8.GetString($bytes)
    }
    catch { Stop-Evidence "scientific_stdout_payload_utf8_invalid" }
    return [ordered]@{
        status = "complete_verified_private_capture"
        bytes = $byteCount
        sha256 = $sha256.ToUpperInvariant()
        text = $decoded
    }
}

function ConvertTo-InvariantFiniteDouble {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )
    $value = 0.0
    if (-not [double]::TryParse($Text, [Globalization.NumberStyles]::Float,
            [Globalization.CultureInfo]::InvariantCulture, [ref]$value) -or
        [double]::IsNaN($value) -or [double]::IsInfinity($value)) {
        Stop-Evidence $FailureCode
    }
    return $value
}

function ConvertTo-NonnegativeInt64 {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )
    $value = 0L
    if (-not [int64]::TryParse($Text, [Globalization.NumberStyles]::None,
            [Globalization.CultureInfo]::InvariantCulture, [ref]$value) -or $value -lt 0) {
        Stop-Evidence $FailureCode
    }
    return $value
}

function Split-ScientificTsvLine {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Line)
    return @($Line.Split([char[]]@("`t"), [StringSplitOptions]::None))
}

function Get-NonemptyScientificLines {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)
    return @(($Text -split "`r?`n") | Where-Object { $_.Length -gt 0 })
}

function Assert-ExactScientificHeader {
    param(
        [Parameter(Mandatory = $true)][string[]]$Actual,
        [Parameter(Mandatory = $true)][string[]]$Expected,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )
    if ($Actual.Count -ne $Expected.Count) { Stop-Evidence $FailureCode }
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        if ($Actual[$index] -cne $Expected[$index]) { Stop-Evidence $FailureCode }
    }
}

function ConvertFrom-RunSummaryText {
    param([Parameter(Mandatory = $true)][string]$Text)
    $lines = @(Get-NonemptyScientificLines $Text)
    if ($lines.Count -ne 2) { Stop-Evidence "run_summary_tsv_shape_invalid" }
    $headers = @(Split-ScientificTsvLine $lines[0])
    $values = @(Split-ScientificTsvLine $lines[1])
    if ($headers.Count -ne $values.Count -or $headers.Count -lt 12) {
        Stop-Evidence "run_summary_tsv_width_invalid"
    }
    $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($header in $headers) {
        if ([string]::IsNullOrWhiteSpace($header) -or -not $seen.Add($header)) {
            Stop-Evidence "run_summary_tsv_header_invalid"
        }
    }
    Assert-ExactScientificHeader -Actual @($headers[0..4]) `
        -Expected @("Filename", "Timestamp", "Vendor", "Model", "Serial#") `
        -FailureCode "run_summary_tsv_leading_header_invalid"
    Assert-ExactScientificHeader -Actual @($headers[($headers.Count - 5)..($headers.Count - 1)]) `
        -Expected @("MinRT", "RT@25%BPI", "RT@50%BPI", "RT@75%BPI", "MaxRT") `
        -FailureCode "run_summary_tsv_trailing_header_invalid"

    $distribution = @()
    $spectrumCount = 0L
    $sawZooms = $false
    $sawCharges = $false
    $pointStats = @{}
    for ($index = 5; $index -lt ($headers.Count - 5); $index++) {
        $header = $headers[$index]
        $value = $values[$index]
        if ($header -match '^MS([1-9]\d*)s$') {
            $count = ConvertTo-NonnegativeInt64 $value "run_summary_ms_count_invalid"
            $spectrumCount += $count
            $distribution += [ordered]@{ msLevel = [int]$Matches[1]; spectrumCount = $count }
        }
        elseif ($header -ceq "MS(others)") {
            $count = ConvertTo-NonnegativeInt64 $value "run_summary_other_ms_count_invalid"
            $spectrumCount += $count
            $distribution += [ordered]@{ msLevel = "other"; spectrumCount = $count }
        }
        elseif ($header -ceq "Zooms") {
            if ($sawZooms) { Stop-Evidence "run_summary_zooms_duplicate" }
            [void](ConvertTo-NonnegativeInt64 $value "run_summary_zooms_invalid")
            $sawZooms = $true
        }
        elseif ($header -ceq "Charges") {
            if ($sawCharges) { Stop-Evidence "run_summary_charges_duplicate" }
            [void](ConvertTo-NonnegativeInt64 $value "run_summary_charges_invalid")
            $sawCharges = $true
        }
        elseif ($header -match '^\+[1-9]\d*s$') {
            [void](ConvertTo-NonnegativeInt64 $value "run_summary_charge_count_invalid")
        }
        elseif ($header -match '^MS([1-9]\d*) Pts(Mean|Min|Q1|Q2|Q3|Max)$') {
            [void](ConvertTo-InvariantFiniteDouble $value "run_summary_point_stat_invalid")
            $level = [int]$Matches[1]
            $stat = $Matches[2]
            if (-not $pointStats.ContainsKey($level)) {
                $pointStats[$level] = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
            }
            if (-not $pointStats[$level].Add($stat)) { Stop-Evidence "run_summary_point_stat_duplicate" }
        }
        else { Stop-Evidence "run_summary_dynamic_header_invalid" }
    }
    if ($distribution.Count -eq 0 -or $spectrumCount -le 0 -or -not $sawZooms -or -not $sawCharges) {
        Stop-Evidence "run_summary_required_counts_missing"
    }
    foreach ($entry in $distribution | Where-Object { $_.msLevel -is [int] }) {
        if (-not $pointStats.ContainsKey($entry.msLevel) -or $pointStats[$entry.msLevel].Count -ne 6) {
            Stop-Evidence "run_summary_point_stats_incomplete"
        }
    }
    $minRt = ConvertTo-InvariantFiniteDouble $values[$values.Count - 5] "run_summary_min_rt_invalid"
    $rt25 = ConvertTo-InvariantFiniteDouble $values[$values.Count - 4] "run_summary_rt25_invalid"
    $rt50 = ConvertTo-InvariantFiniteDouble $values[$values.Count - 3] "run_summary_rt50_invalid"
    $rt75 = ConvertTo-InvariantFiniteDouble $values[$values.Count - 2] "run_summary_rt75_invalid"
    $maxRt = ConvertTo-InvariantFiniteDouble $values[$values.Count - 1] "run_summary_max_rt_invalid"
    if ($minRt -gt $maxRt) { Stop-Evidence "run_summary_rt_range_invalid" }
    return [ordered]@{
        status = "observed_exact_complete_stdout_tsv"
        rowCount = 1
        headerSha256 = Get-Sha256OfBytes ([Text.Encoding]::UTF8.GetBytes($lines[0]))
        rowSha256 = Get-Sha256OfBytes ([Text.Encoding]::UTF8.GetBytes($lines[1]))
        spectrumCount = $spectrumCount
        msLevelDistribution = @($distribution)
        retentionTimeRange = [ordered]@{
            min = $minRt
            rtAt25PercentBasePeakIntensity = $rt25
            rtAt50PercentBasePeakIntensity = $rt50
            rtAt75PercentBasePeakIntensity = $rt75
            max = $maxRt
            units = [ordered]@{ status = "D_not_emitted_by_run_summary"; value = $null }
        }
        chromatogramCount = [ordered]@{ status = "D_not_emitted_by_run_summary"; value = $null }
    }
}

function ConvertFrom-MetadataText {
    param([Parameter(Mandatory = $true)][string]$Text)
    $required = @("fileDescription", "sampleList", "instrumentConfigurationList", "softwareList")
    $observed = @()
    foreach ($section in $required) {
        $matches = [regex]::Matches($Text, '(?m)^\s*' + [regex]::Escape($section) + ':\s*\r?$')
        if ($matches.Count -ne 1) { Stop-Evidence "metadata_section_schema_invalid" }
        $observed += $section
    }
    $dataProcessing = [regex]::Matches($Text, '(?m)^\s*dataProcessingList\s*\r?$')
    if ($dataProcessing.Count -ne 1) { Stop-Evidence "metadata_section_schema_invalid" }
    $observed += "dataProcessingList"
    return [ordered]@{
        status = "observed_exact_section_schema"
        lineCount = @($Text -split "`r?`n").Count
        requiredSectionCount = $required.Count + 1
        requiredSectionsObserved = @($observed)
        metadataValuesRetained = $false
    }
}

function ConvertFrom-SpectrumTableText {
    param([Parameter(Mandatory = $true)][string]$Text)
    $lines = @(Get-NonemptyScientificLines $Text)
    if ($lines.Count -lt 3 -or $lines[0] -notmatch '^#\s+\S') {
        Stop-Evidence "spectrum_table_shape_invalid"
    }
    $expectedHeader = @(
        "index", "id", "event", "analyzer", "msLevel", "rt", "mzLow", "mzHigh",
        "basePeakMZ", "basePeakInt", "TIC", "charge", "precursorMZ", "thermo_monoMZ",
        "filterStringMZ", "ionInjectionTime"
    )
    $header = @(Split-ScientificTsvLine $lines[1])
    Assert-ExactScientificHeader -Actual $header -Expected $expectedHeader `
        -FailureCode "spectrum_table_header_invalid"
    $seenIndices = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $distribution = @{}
    $firstRelation = $null
    for ($lineIndex = 2; $lineIndex -lt $lines.Count; $lineIndex++) {
        $row = @(Split-ScientificTsvLine $lines[$lineIndex])
        if ($row.Count -ne $expectedHeader.Count) { Stop-Evidence "spectrum_table_row_width_invalid" }
        $index = ConvertTo-NonnegativeInt64 $row[0] "spectrum_table_index_invalid"
        if ($index -ne ($lineIndex - 2)) { Stop-Evidence "spectrum_table_index_sequence_invalid" }
        if (-not $seenIndices.Add([string]$index)) { Stop-Evidence "spectrum_table_index_duplicate" }
        $safeId = ConvertTo-SanitizedScientificLine $row[1]
        if ([string]::IsNullOrWhiteSpace($safeId)) { Stop-Evidence "spectrum_table_id_invalid" }
        if ($row[4] -notmatch '^ms([1-9]\d*)$') { Stop-Evidence "spectrum_table_ms_level_invalid" }
        $msLevel = [int]$Matches[1]
        if (-not $distribution.ContainsKey($msLevel)) { $distribution[$msLevel] = 0L }
        $distribution[$msLevel]++
        foreach ($columnIndex in 5..10) {
            [void](ConvertTo-InvariantFiniteDouble $row[$columnIndex] "spectrum_table_numeric_field_invalid")
        }
        foreach ($columnIndex in 11..15) {
            if (-not [string]::IsNullOrWhiteSpace($row[$columnIndex])) {
                [void](ConvertTo-InvariantFiniteDouble $row[$columnIndex] `
                    "spectrum_table_optional_numeric_field_invalid")
            }
        }
        if ($null -eq $firstRelation) {
            $firstRelation = [ordered]@{
                index = $index
                nativeId = $safeId
                msLevel = $msLevel
                retentionTime = ConvertTo-InvariantFiniteDouble $row[5] "spectrum_table_rt_invalid"
            }
        }
    }
    $msLevels = @($distribution.Keys | Sort-Object)
    return [ordered]@{
        status = "observed_exact_tsv_file"
        rowCount = $lines.Count - 2
        headerSha256 = Get-Sha256OfBytes ([Text.Encoding]::UTF8.GetBytes($lines[1]))
        normalizedRowsSha256 = Get-Sha256OfBytes `
            ([Text.Encoding]::UTF8.GetBytes([string]::Join("`n", @($lines[2..($lines.Count - 1)]))))
        nativeIdIndexRelation = $firstRelation
        msLevelDistribution = @($msLevels | ForEach-Object {
            [ordered]@{ msLevel = [int]$_; spectrumCount = [int64]$distribution[$_] }
        })
    }
}

function ConvertFrom-TicText {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [switch]$RequireContiguousIndices
    )
    $lines = @(Get-NonemptyScientificLines $Text)
    if ($lines.Count -lt 2 -or $lines[0] -notmatch '^#\s+\S') {
        Stop-Evidence "tic_tsv_shape_invalid"
    }
    $expectedHeader = @("# index", "id", "event", "analyzer", "msLevel", "rt", "sumIntensity")
    $header = @(Split-ScientificTsvLine $lines[1])
    Assert-ExactScientificHeader -Actual $header -Expected $expectedHeader `
        -FailureCode "tic_tsv_header_invalid"
    $seenIndices = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $distribution = @{}
    $normalizedRows = [System.Collections.Generic.List[string]]::new()
    $first = $null
    $last = $null
    $rtMin = $null
    $rtMax = $null
    $intensityMin = $null
    $intensityMax = $null
    $previousIndex = $null
    for ($lineIndex = 2; $lineIndex -lt $lines.Count; $lineIndex++) {
        $row = @(Split-ScientificTsvLine $lines[$lineIndex])
        if ($row.Count -ne $expectedHeader.Count) { Stop-Evidence "tic_tsv_row_width_invalid" }
        $index = ConvertTo-NonnegativeInt64 $row[0] "tic_tsv_index_invalid"
        if ($RequireContiguousIndices -and $index -ne ($lineIndex - 2)) {
            Stop-Evidence "tic_tsv_index_sequence_invalid"
        }
        if ($null -ne $previousIndex -and $index -le $previousIndex) {
            Stop-Evidence "tic_tsv_index_order_invalid"
        }
        $previousIndex = $index
        if (-not $seenIndices.Add([string]$index)) { Stop-Evidence "tic_tsv_index_duplicate" }
        $safeId = ConvertTo-SanitizedScientificLine $row[1]
        if ([string]::IsNullOrWhiteSpace($safeId)) { Stop-Evidence "tic_tsv_id_invalid" }
        if ($row[4] -notmatch '^ms([1-9]\d*)$') { Stop-Evidence "tic_tsv_ms_level_invalid" }
        $msLevel = [int]$Matches[1]
        $rt = ConvertTo-InvariantFiniteDouble $row[5] "tic_tsv_rt_invalid"
        $intensity = ConvertTo-InvariantFiniteDouble $row[6] "tic_tsv_intensity_invalid"
        if (-not $distribution.ContainsKey($msLevel)) { $distribution[$msLevel] = 0L }
        $distribution[$msLevel]++
        if ($null -eq $rtMin -or $rt -lt $rtMin) { $rtMin = $rt }
        if ($null -eq $rtMax -or $rt -gt $rtMax) { $rtMax = $rt }
        if ($null -eq $intensityMin -or $intensity -lt $intensityMin) { $intensityMin = $intensity }
        if ($null -eq $intensityMax -or $intensity -gt $intensityMax) { $intensityMax = $intensity }
        $point = [ordered]@{ index = $index; msLevel = $msLevel; rt = $rt; sumIntensity = $intensity }
        if ($null -eq $first) { $first = $point }
        $last = $point
        $normalizedRows.Add($lines[$lineIndex])
    }
    $rowHash = if ($normalizedRows.Count -eq 0) {
        Get-Sha256OfBytes ([byte[]]::new(0))
    }
    else {
        Get-Sha256OfBytes ([Text.Encoding]::UTF8.GetBytes([string]::Join("`n", $normalizedRows)))
    }
    $msLevels = @($distribution.Keys | Sort-Object)
    return [ordered]@{
        status = "observed_exact_tsv_file"
        rowCount = $normalizedRows.Count
        headerSha256 = Get-Sha256OfBytes ([Text.Encoding]::UTF8.GetBytes($lines[1]))
        normalizedRowsSha256 = $rowHash
        msLevelDistribution = @($msLevels | ForEach-Object {
            [ordered]@{ msLevel = [int]$_; spectrumCount = [int64]$distribution[$_] }
        })
        retentionTimeRange = [ordered]@{ min = $rtMin; max = $rtMax }
        intensityRange = [ordered]@{ min = $intensityMin; max = $intensityMax }
        firstPoint = $first
        lastPoint = $last
    }
}

function ConvertFrom-BinarySpectrumText {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][int64]$RequestedIndex
    )
    $lines = @(Get-NonemptyScientificLines $Text)
    if ($lines.Count -lt 18 -or $lines[0] -notmatch '^#\s+\S' -or $lines[1] -cne '#') {
        Stop-Evidence "binary_spectrum_shape_invalid"
    }
    $expectedHeaders = @(
        "index", "id", "scanNumber", "massAnalyzerType", "scanEvent", "msLevel",
        "retentionTime", "filterString", "mzLow", "mzHigh", "basePeakMZ",
        "basePeakIntensity", "totalIonCurrent", "precursorCount"
    )
    $headers = [ordered]@{}
    $headerOrder = @()
    $precursorRows = @()
    $binaryCount = $null
    $binaryMarker = -1
    for ($lineIndex = 2; $lineIndex -lt $lines.Count; $lineIndex++) {
        $line = $lines[$lineIndex]
        if ($line -match '^# binary \((\d+)\):\s*$') {
            $binaryCount = ConvertTo-NonnegativeInt64 $Matches[1] "binary_spectrum_count_invalid"
            $binaryMarker = $lineIndex
            break
        }
        if ($line -match '^# precursor (\d+):\s+(\S+)\s+(\S+)$') {
            $precursorRows += [ordered]@{
                index = ConvertTo-NonnegativeInt64 $Matches[1] "binary_spectrum_precursor_index_invalid"
                mz = ConvertTo-InvariantFiniteDouble $Matches[2] "binary_spectrum_precursor_mz_invalid"
                intensity = ConvertTo-InvariantFiniteDouble $Matches[3] "binary_spectrum_precursor_intensity_invalid"
            }
            continue
        }
        if ($line -notmatch '^# ([A-Za-z][A-Za-z0-9]*):(?:\s?(.*))$') {
            Stop-Evidence "binary_spectrum_header_line_invalid"
        }
        $name = $Matches[1]
        if ($headers.Contains($name)) { Stop-Evidence "binary_spectrum_header_duplicate" }
        $headers[$name] = $Matches[2]
        $headerOrder += $name
    }
    if ($binaryMarker -lt 0 -or $null -eq $binaryCount -or $binaryCount -le 0) {
        Stop-Evidence "binary_spectrum_marker_missing"
    }
    Assert-ExactScientificHeader -Actual @($headerOrder) -Expected $expectedHeaders `
        -FailureCode "binary_spectrum_header_order_invalid"
    $indexValue = ConvertTo-NonnegativeInt64 ([string]$headers.index) "binary_spectrum_index_invalid"
    if ($indexValue -ne $RequestedIndex) { Stop-Evidence "binary_spectrum_requested_index_mismatch" }
    $safeId = ConvertTo-SanitizedScientificLine ([string]$headers.id)
    if ([string]::IsNullOrWhiteSpace($safeId)) { Stop-Evidence "binary_spectrum_id_invalid" }
    $scanNumber = ConvertTo-NonnegativeInt64 ([string]$headers.scanNumber) "binary_spectrum_scan_number_invalid"
    $msLevel = ConvertTo-NonnegativeInt64 ([string]$headers.msLevel) "binary_spectrum_ms_level_invalid"
    if ($msLevel -le 0) { Stop-Evidence "binary_spectrum_ms_level_invalid" }
    $retentionTime = ConvertTo-InvariantFiniteDouble ([string]$headers.retentionTime) `
        "binary_spectrum_retention_time_invalid"
    foreach ($name in @("mzLow", "mzHigh", "basePeakMZ", "basePeakIntensity", "totalIonCurrent")) {
        [void](ConvertTo-InvariantFiniteDouble ([string]$headers[$name]) "binary_spectrum_numeric_header_invalid")
    }
    $precursorCount = ConvertTo-NonnegativeInt64 ([string]$headers.precursorCount) `
        "binary_spectrum_precursor_count_invalid"
    if ($precursorRows.Count -ne $precursorCount) { Stop-Evidence "binary_spectrum_precursor_count_mismatch" }
    for ($index = 0; $index -lt $precursorRows.Count; $index++) {
        if ($precursorRows[$index].index -ne $index) { Stop-Evidence "binary_spectrum_precursor_sequence_invalid" }
    }

    $dataLines = if ($binaryMarker -eq ($lines.Count - 1)) { @() }
        else { @($lines[($binaryMarker + 1)..($lines.Count - 1)]) }
    if ($dataLines.Count -ne $binaryCount) { Stop-Evidence "binary_spectrum_data_count_mismatch" }
    $mzTokens = [System.Collections.Generic.List[string]]::new()
    $intensityTokens = [System.Collections.Generic.List[string]]::new()
    $mzMin = $null
    $mzMax = $null
    $intensityMin = $null
    $intensityMax = $null
    $maximumFractionDigits = 0
    foreach ($line in $dataLines) {
        $columns = @($line.Trim() -split '\s+')
        if ($columns.Count -ne 2) { Stop-Evidence "binary_spectrum_data_width_invalid" }
        $mz = ConvertTo-InvariantFiniteDouble $columns[0] "binary_spectrum_mz_invalid"
        $intensity = ConvertTo-InvariantFiniteDouble $columns[1] "binary_spectrum_intensity_invalid"
        foreach ($token in $columns) {
            $fraction = [regex]::Match($token, '\.(\d+)')
            if ($fraction.Success) {
                $maximumFractionDigits = [Math]::Max($maximumFractionDigits, $fraction.Groups[1].Value.Length)
            }
        }
        $mzTokens.Add($columns[0])
        $intensityTokens.Add($columns[1])
        if ($null -eq $mzMin -or $mz -lt $mzMin) { $mzMin = $mz }
        if ($null -eq $mzMax -or $mz -gt $mzMax) { $mzMax = $mz }
        if ($null -eq $intensityMin -or $intensity -lt $intensityMin) { $intensityMin = $intensity }
        if ($null -eq $intensityMax -or $intensity -gt $intensityMax) { $intensityMax = $intensity }
    }
    if ($maximumFractionDigits -gt 8) { Stop-Evidence "binary_spectrum_precision_exceeded" }
    return [ordered]@{
        status = "observed_exact_binary_file"
        nativeIdIndexRelation = [ordered]@{
            requestedIndex = $RequestedIndex
            reportedIndex = $indexValue
            nativeId = $safeId
            scanNumber = $scanNumber
        }
        msLevel = $msLevel
        retentionTime = $retentionTime
        massAnalyzerType = Get-ObservedOrUnverified `
            (ConvertTo-SanitizedScientificLine ([string]$headers.massAnalyzerType))
        scanEvent = Get-ObservedOrUnverified `
            (ConvertTo-SanitizedScientificLine ([string]$headers.scanEvent))
        precursorCount = $precursorCount
        precursors = @($precursorRows)
        declaredPairCount = $binaryCount
        observedPairCount = $dataLines.Count
        arrayLengthsMatch = $mzTokens.Count -eq $intensityTokens.Count -and $mzTokens.Count -eq $binaryCount
        mz = [ordered]@{
            count = $mzTokens.Count
            min = $mzMin
            max = $mzMax
            normalizedSha256 = Get-Sha256OfBytes `
                ([Text.Encoding]::UTF8.GetBytes([string]::Join("`n", $mzTokens)))
        }
        intensity = [ordered]@{
            count = $intensityTokens.Count
            min = $intensityMin
            max = $intensityMax
            normalizedSha256 = Get-Sha256OfBytes `
                ([Text.Encoding]::UTF8.GetBytes([string]::Join("`n", $intensityTokens)))
        }
        numericPrecision = [ordered]@{
            requestedFormatterPrecision = 8
            observedMaximumFractionDigits = $maximumFractionDigits
            withinRequestedBound = $true
        }
        units = [ordered]@{ status = "D_not_emitted"; value = $null }
        profileOrCentroid = [ordered]@{ status = "D_not_emitted"; value = $null }
    }
}

function Get-ScientificTextObservations {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][string]$OperationName
    )
    $observations = [ordered]@{
        inspectedTextFiles = 0
        totalLines = 0
        numericTokenCount = 0
        spectrumCountTerm = $false
        chromatogramCountTerm = $false
        msLevelTerm = $false
        retentionTimeTerm = $false
        ticTerm = $false
        bpcTerm = $false
        nativeIdTerm = $false
        indexTerm = $false
        mzArrayTerm = $false
        intensityArrayTerm = $false
        mzArrayLength = $null
        intensityArrayLength = $null
        arrayLengthsMatch = $null
        maximumFractionDigits = $null
        unitsTerm = $false
        profileTerm = $false
        centroidTerm = $false
        precursorTerm = $false
        sanitizedExcerpt = @()
        omittedUnsafeExcerptLines = 0
    }
    $numericPattern = '(?<![A-Za-z0-9_.])[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?(?![A-Za-z0-9_.])'
    $mzCount = 0
    $intensityCount = 0
    $fractionDigits = 0
    $mzValues = [System.Collections.Generic.List[string]]::new()
    $intensityValues = [System.Collections.Generic.List[string]]::new()
    $ticValues = [System.Collections.Generic.List[string]]::new()
    $spectrumCount = $null
    $chromatogramCount = $null
    $msLevelEvidence = $null
    $retentionTimeEvidence = $null
    $nativeIndexEvidence = $null
    foreach ($file in Get-ChildItem -LiteralPath $Directory -Recurse -File -Force) {
        if ($file.Length -gt 4MB -or $file.Extension -match '^(?i:\.mzML|\.mzXML)$') { continue }
        try { $text = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8) }
        catch { continue }
        $observations.inspectedTextFiles++
        $lines = @($text -split "`r?`n")
        $observations.totalLines += $lines.Count
        $matches = [regex]::Matches($text, $numericPattern)
        $observations.numericTokenCount += $matches.Count
        foreach ($match in $matches) {
            if ($match.Value -match '\.(\d+)') {
                $fractionDigits = [Math]::Max($fractionDigits, $Matches[1].Length)
            }
        }
        $observations.spectrumCountTerm = $observations.spectrumCountTerm -or $text -match '(?i)spectr(?:um|a).{0,24}count|count.{0,24}spectr(?:um|a)'
        $observations.chromatogramCountTerm = $observations.chromatogramCountTerm -or $text -match '(?i)chromatogram.{0,24}count|count.{0,24}chromatogram'
        $observations.msLevelTerm = $observations.msLevelTerm -or $text -match '(?i)\bms\s*level\b|\bmsLevel\b'
        $observations.retentionTimeTerm = $observations.retentionTimeTerm -or $text -match '(?i)retention\s*time|\bRT\b'
        $observations.ticTerm = $observations.ticTerm -or $text -match '(?i)\bTIC\b|total\s+ion\s+current'
        $observations.bpcTerm = $observations.bpcTerm -or $text -match '(?i)\bBPC\b|base\s+peak\s+chromatogram'
        $observations.nativeIdTerm = $observations.nativeIdTerm -or $text -match '(?i)native\s*id'
        $observations.indexTerm = $observations.indexTerm -or $text -match '(?i)\bindex\b'
        $observations.mzArrayTerm = $observations.mzArrayTerm -or $text -match '(?i)(?:m\s*/\s*z|mass.to.charge).{0,24}array|array.{0,24}(?:m\s*/\s*z|mass.to.charge)'
        $observations.intensityArrayTerm = $observations.intensityArrayTerm -or $text -match '(?i)intensit(?:y|ies).{0,24}array|array.{0,24}intensit(?:y|ies)'
        $observations.unitsTerm = $observations.unitsTerm -or $text -match '(?i)\bunit(?:s)?\b|second|minute|m/z'
        $observations.profileTerm = $observations.profileTerm -or $text -match '(?i)\bprofile\b'
        $observations.centroidTerm = $observations.centroidTerm -or $text -match '(?i)\bcentroid(?:ed)?\b'
        $observations.precursorTerm = $observations.precursorTerm -or $text -match '(?i)\bprecursor\b'

        $arrayMode = ""
        foreach ($line in $lines) {
            $sanitized = ConvertTo-SanitizedScientificLine $line
            $lineHasScientificLabel = $line -match '(?i)spectr|chromatogram|ms\s*level|msLevel|retention|\bRT\b|\bTIC\b|\bBPC\b|native\s*id|\bindex\b|m\s*/\s*z|intensit|precision|profile|centroid|precursor'
            $lineIsQueryData = $OperationName -match '^(tic|spectrum)' -and
                [regex]::Matches($line, $numericPattern).Count -ge 2
            if (($lineHasScientificLabel -or $lineIsQueryData) -and $observations.sanitizedExcerpt.Count -lt 64) {
                if ($null -eq $sanitized) { $observations.omittedUnsafeExcerptLines++ }
                elseif ($sanitized.Length -gt 0) { $observations.sanitizedExcerpt += $sanitized }
            }

            if ($null -eq $spectrumCount -and $line -match '(?i)^\s*(?:spectrum(?:s|\s+count)?|spectrumCount)\s*[:=\t]\s*(\d+)\b') {
                $spectrumCount = [int64]$Matches[1]
            }
            if ($null -eq $chromatogramCount -and $line -match '(?i)^\s*(?:chromatogram(?:s|\s+count)?|chromatogramCount)\s*[:=\t]\s*(\d+)\b') {
                $chromatogramCount = [int64]$Matches[1]
            }
            if ($null -eq $msLevelEvidence -and $line -match '(?i)\bms\s*levels?\b|\bmsLevel\b') {
                $msLevelEvidence = $sanitized
            }
            if ($null -eq $retentionTimeEvidence -and
                $line -match '(?i)retention\s*time|\bRT\b' -and
                [regex]::Matches($line, $numericPattern).Count -ge 2) {
                $retentionTimeEvidence = $sanitized
            }
            if ($null -eq $nativeIndexEvidence -and $line -match '(?i)native\s*id' -and $line -match '(?i)\bindex\b') {
                $nativeIndexEvidence = $sanitized
            }

            if ($OperationName -match '^tic' -and $lineIsQueryData) {
                foreach ($number in [regex]::Matches($line, $numericPattern)) {
                    if ($ticValues.Count -lt 100000) { $ticValues.Add($number.Value) }
                }
            }
            if ($line -match '(?i)(?:m\s*/\s*z|mass.to.charge).{0,24}array') {
                $arrayMode = "mz"
            }
            elseif ($line -match '(?i)intensit(?:y|ies).{0,24}array') {
                $arrayMode = "intensity"
            }
            elseif ($arrayMode -ne "" -and $line -match '^\s*[A-Za-z#]') {
                $arrayMode = ""
            }
            if ($arrayMode -ne "") {
                $lineNumbers = [regex]::Matches($line, $numericPattern)
                $count = $lineNumbers.Count
                if ($arrayMode -eq "mz") {
                    $mzCount += $count
                    foreach ($number in $lineNumbers) {
                        if ($mzValues.Count -lt 100000) { $mzValues.Add($number.Value) }
                    }
                }
                else {
                    $intensityCount += $count
                    foreach ($number in $lineNumbers) {
                        if ($intensityValues.Count -lt 100000) { $intensityValues.Add($number.Value) }
                    }
                }
            }
        }
    }
    if ($observations.numericTokenCount -gt 0) { $observations.maximumFractionDigits = $fractionDigits }
    if ($observations.mzArrayTerm) { $observations.mzArrayLength = $mzCount }
    if ($observations.intensityArrayTerm) { $observations.intensityArrayLength = $intensityCount }
    if ($observations.mzArrayTerm -and $observations.intensityArrayTerm) {
        $observations.arrayLengthsMatch = $mzCount -gt 0 -and $mzCount -eq $intensityCount
    }
    $observations.structured = [ordered]@{
        spectrumCount = Get-ObservedOrUnverified $spectrumCount
        chromatogramCount = Get-ObservedOrUnverified $chromatogramCount
        msLevelDistribution = Get-ObservedOrUnverified $msLevelEvidence
        retentionTimeRange = Get-ObservedOrUnverified $retentionTimeEvidence
        nativeIdIndexRelation = Get-ObservedOrUnverified $nativeIndexEvidence
        ticSeries = $(if ($ticValues.Count -gt 0) {
            [ordered]@{
                status = "observed_bounded_numeric_parse"
                numericValueCount = $ticValues.Count
                normalizedSha256 = Get-Sha256OfBytes ([System.Text.Encoding]::UTF8.GetBytes([string]::Join("`n", $ticValues)))
            }
        } else { [ordered]@{ status = "D_not_observed"; numericValueCount = 0; normalizedSha256 = $null } })
        selectedSpectrumArrays = $(if ($mzValues.Count -gt 0 -and $intensityValues.Count -gt 0) {
            [ordered]@{
                status = "observed_labeled_numeric_arrays"
                mzLength = $mzCount
                intensityLength = $intensityCount
                lengthsMatch = $mzCount -eq $intensityCount
                mzNormalizedSha256 = Get-Sha256OfBytes ([System.Text.Encoding]::UTF8.GetBytes([string]::Join("`n", $mzValues)))
                intensityNormalizedSha256 = Get-Sha256OfBytes ([System.Text.Encoding]::UTF8.GetBytes([string]::Join("`n", $intensityValues)))
                maximumFractionDigits = $observations.maximumFractionDigits
                unitsObserved = $observations.unitsTerm
                precursorObserved = $observations.precursorTerm
                profileObserved = $observations.profileTerm
                centroidObserved = $observations.centroidTerm
            }
        } else {
            [ordered]@{
                status = "D_not_observed"
                mzLength = $mzCount
                intensityLength = $intensityCount
                lengthsMatch = $null
                mzNormalizedSha256 = $null
                intensityNormalizedSha256 = $null
            }
        })
    }
    return $observations
}

function Get-XmlStructure {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    $settings = [System.Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $settings.MaxCharactersFromEntities = 0
    $settings.MaxCharactersInDocument = 128MB
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
        if ($_.Exception.Message -match '^M0B:[a-z0-9_]+$') { return }
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
        Name = "M0B-selftest-rule"
        DisplayName = "MSCanvas disposable M0B outbound block"
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
    $name = "M0B-selftest-rule"
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

function Invoke-ScientificParserSelfTest {
    $runHeaders = @("Filename", "Timestamp", "Vendor", "Model", "Serial#", "MS1s", "MS2s",
        "Zooms", "Charges", "+2s")
    $runValues = @("tiny.mzML", "2026-01-01", "synthetic", "model", "serial", "1", "1",
        "0", "1", "1")
    foreach ($level in 1..2) {
        foreach ($stat in @("Mean", "Min", "Q1", "Q2", "Q3", "Max")) {
            $runHeaders += "MS$level Pts$stat"
            $runValues += "2.5"
        }
    }
    $runHeaders += @("MinRT", "RT@25%BPI", "RT@50%BPI", "RT@75%BPI", "MaxRT")
    $runValues += @("0.1", "0.2", "0.3", "0.4", "0.5")
    $runText = [string]::Join("`t", $runHeaders) + "`n" + [string]::Join("`t", $runValues) + "`n"
    $run = ConvertFrom-RunSummaryText $runText
    if ($run.spectrumCount -ne 2 -or $run.msLevelDistribution.Count -ne 2) {
        Stop-Evidence "scientific_parser_selftest_failed"
    }

    $metadataText = @'
fileDescription:
sampleList:
instrumentConfigurationList:
softwareList:
dataProcessingList
'@
    $metadata = ConvertFrom-MetadataText $metadataText
    if ($metadata.requiredSectionCount -ne 5) { Stop-Evidence "scientific_parser_selftest_failed" }

    $spectrumHeader = @(
        "index", "id", "event", "analyzer", "msLevel", "rt", "mzLow", "mzHigh",
        "basePeakMZ", "basePeakInt", "TIC", "charge", "precursorMZ", "thermo_monoMZ",
        "filterStringMZ", "ionInjectionTime"
    )
    $spectrumRows = @(
        @("0", "scan=1", "1", "FTMS", "ms1", "0.1", "100", "1000", "500", "50", "100", "", "", "", "", ""),
        @("1", "scan=2", "2", "ITMS", "ms2", "0.2", "50", "500", "250", "25", "75", "2", "445.3", "445.3", "445.3", "10")
    )
    $spectrumText = "# tiny.mzML`n" + [string]::Join("`t", $spectrumHeader) + "`n" +
        [string]::Join("`n", @($spectrumRows | ForEach-Object { [string]::Join("`t", $_) })) + "`n"
    $table = ConvertFrom-SpectrumTableText $spectrumText
    if ($table.rowCount -ne 2 -or $table.nativeIdIndexRelation.index -ne 0) {
        Stop-Evidence "scientific_parser_selftest_failed"
    }

    $ticHeader = @("# index", "id", "event", "analyzer", "msLevel", "rt", "sumIntensity")
    $ticRows = @(
        @("0", "scan=1", "1", "FTMS", "ms1", "0.1", "100"),
        @("1", "scan=2", "2", "ITMS", "ms2", "0.2", "75")
    )
    $ticText = "# tiny.mzML`n" + [string]::Join("`t", $ticHeader) + "`n" +
        [string]::Join("`n", @($ticRows | ForEach-Object { [string]::Join("`t", $_) })) + "`n"
    $tic = ConvertFrom-TicText $ticText
    if ($tic.rowCount -ne 2 -or $tic.intensityRange.max -ne 100) {
        Stop-Evidence "scientific_parser_selftest_failed"
    }

    $binaryText = @'
# tiny.mzML
#
# index: 0
# id: scan=1
# scanNumber: 1
# massAnalyzerType: FTMS
# scanEvent: 1
# msLevel: 1
# retentionTime: 0.1
# filterString: synthetic
# mzLow: 100
# mzHigh: 1000
# basePeakMZ: 500
# basePeakIntensity: 50
# totalIonCurrent: 100
# precursorCount: 1
# precursor 0: 445.30000000 12.00000000
# binary (2):
100.12345678 10.00000000
200.12345678 20.00000000
'@
    $binary = ConvertFrom-BinarySpectrumText $binaryText 0
    if ($binary.declaredPairCount -ne 2 -or -not $binary.arrayLengthsMatch -or
        $binary.numericPrecision.observedMaximumFractionDigits -ne 8) {
        Stop-Evidence "scientific_parser_selftest_failed"
    }

    $payloadBytes = [Text.Encoding]::UTF8.GetBytes($runText)
    $payloadBase64 = [Convert]::ToBase64String($payloadBytes)
    $payloadLines = [System.Collections.Generic.List[string]]::new()
    $payloadLines.Add("scientific.stdout_payload_status=complete")
    $payloadLines.Add("scientific.stdout_sha256=$(Get-Sha256OfBytes $payloadBytes)")
    $payloadLines.Add("scientific.stdout_bytes=$($payloadBytes.Length)")
    $payloadChunkCount = [int][Math]::Ceiling($payloadBase64.Length / 256.0)
    $payloadLines.Add("scientific.stdout_base64_chunk_count=$payloadChunkCount")
    for ($index = 0; $index -lt $payloadChunkCount; $index++) {
        $length = [Math]::Min(256, $payloadBase64.Length - ($index * 256))
        $payloadLines.Add("scientific.stdout_base64[$index]=$($payloadBase64.Substring($index * 256, $length))")
    }
    $payloadHarnessText = [string]::Join("`n", $payloadLines) + "`n"
    $payload = Get-PrivateScientificStdoutPayload $payloadHarnessText
    if ($payload.text -cne $runText -or $payload.status -ne "complete_verified_private_capture") {
        Stop-Evidence "scientific_parser_selftest_failed"
    }
    $badPayload = $payloadHarnessText.Replace(
        "scientific.stdout_bytes=$($payloadBytes.Length)",
        "scientific.stdout_bytes=$($payloadBytes.Length + 1)"
    )
    Assert-SelfTestRejects { Get-PrivateScientificStdoutPayload $badPayload } `
        "scientific_parser_selftest_rejection_failed"
    $badTable = $spectrumText + "2`ttoo-short`n"
    Assert-SelfTestRejects { ConvertFrom-SpectrumTableText $badTable } `
        "scientific_parser_selftest_rejection_failed"
    $badBinary = $binaryText.Replace('# binary (2):', '# binary (3):')
    Assert-SelfTestRejects { ConvertFrom-BinarySpectrumText $badBinary 0 } `
        "scientific_parser_selftest_rejection_failed"
    return [ordered]@{ passed = $true; caseCount = 8; malformedCasesRejected = 3 }
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
    $existingSummaryVariable = Get-Variable -Scope Script -Name Summary -ErrorAction SilentlyContinue
    $previousSummary = if ($null -ne $existingSummaryVariable) { $existingSummaryVariable.Value } else { $null }
    try {
        $script:Summary = [ordered]@{
            scientificCrossChecks = [ordered]@{ controlledCheck = $false }
        }
        $gated = Add-ScientificCrossCheckGate (New-CapabilityAssessment "A" "controlled" "none") `
            "controlled capability" @("controlledCheck")
        if ($gated.rating -ne "C") { Stop-Evidence "capability_gate_selftest_failed" }
        $script:Summary.scientificCrossChecks.controlledCheck = $true
        $gated = Add-ScientificCrossCheckGate (New-CapabilityAssessment "A" "controlled" "none") `
            "controlled capability" @("controlledCheck")
        if ($gated.rating -ne "A") { Stop-Evidence "capability_gate_selftest_failed" }
        if (-not (Test-ExactScientificObserved ([ordered]@{
                exactScientific = [ordered]@{ status = "observed_exact_controlled" }
            })) -or
            (Test-ExactScientificObserved ([ordered]@{
                exactScientific = [ordered]@{ status = "observed_backend_failure" }
            })) -or
            (Test-ExactScientificObserved ([ordered]@{
                exactScientific = [ordered]@{ status = "observed_no_output" }
            }))) {
            Stop-Evidence "exact_scientific_status_selftest_failed"
        }
    }
    finally {
        if ($null -ne $existingSummaryVariable) { $script:Summary = $previousSummary }
        else { Remove-Variable -Scope Script -Name Summary -ErrorAction SilentlyContinue }
    }
    return [ordered]@{
        embeddedNativeTypesCompiled = $true
        helpParser = [ordered]@{ passed = $true; queryCount = $queries.Count; nearMissRejected = $true }
        emptyCaptureStreams = [ordered]@{ passed = $true; sha256Verified = $true; utf8Verified = $true }
        summaryRoundTrip = [ordered]@{ passed = $true }
        capabilityCrossCheckGate = [ordered]@{ passed = $true; contradictionDowngradedToC = $true }
        archiveMembers = Invoke-ArchiveMemberSelfTest -TempRoot $TempRoot
        firewallRuleProjection = Invoke-FirewallRuleProjectionSelfTest
        cleanupState = Invoke-CleanupStateSelfTest -TempRoot $TempRoot
        evidencePublication = Invoke-EvidencePublicationSelfTest -TempRoot $TempRoot
        sanitizer = Invoke-SanitizerSelfTest
        scientificParsers = Invoke-ScientificParserSelfTest
        conversionValidator = Invoke-ConversionValidatorSelfTest $layout
    }
}

function Get-ExactScientificOutputText {
    param([Parameter(Mandatory = $true)][string]$Directory)
    $items = @(Get-ChildItem -LiteralPath $Directory -Recurse -Force)
    $files = @($items | Where-Object { -not $_.PSIsContainer })
    if ($items.Count -ne 1 -or $files.Count -ne 1 -or $files[0].Length -le 0 -or
        $files[0].Length -gt 8MB -or
        ($files[0].Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        Stop-Evidence "exact_scientific_output_file_set_invalid"
    }
    try {
        $strictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)
        return [System.IO.File]::ReadAllText($files[0].FullName, $strictUtf8)
    }
    catch { Stop-Evidence "exact_scientific_output_utf8_invalid" }
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

function Get-ExactScientificObservation {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Inventory,
        $BackendExitCode,
        $PrivatePayload
    )
    if ($Name -eq "spectrum_unavailable") {
        if ($Inventory.itemCount -ne 0 -or $Inventory.fileCount -ne 0) {
            Stop-Evidence "unavailable_spectrum_created_output"
        }
        return [ordered]@{
            status = "observed_no_output"
            backendExitCode = $BackendExitCode
            zeroGeneratedFiles = $true
        }
    }
    if ($null -eq $BackendExitCode -or $BackendExitCode -ne 0) {
        return [ordered]@{
            status = "observed_backend_failure"
            backendExitCode = $BackendExitCode
        }
    }
    switch ($Name) {
        "metadata" {
            return ConvertFrom-MetadataText (Get-ExactScientificOutputText $Directory)
        }
        "run_summary" {
            if ($Inventory.itemCount -ne 0 -or $Inventory.fileCount -ne 0 -or
                $null -eq $PrivatePayload -or
                $PrivatePayload.status -ne "complete_verified_private_capture") {
                Stop-Evidence "run_summary_complete_stdout_unavailable"
            }
            return ConvertFrom-RunSummaryText ([string]$PrivatePayload.text)
        }
        "spectrum_table" {
            return ConvertFrom-SpectrumTableText (Get-ExactScientificOutputText $Directory)
        }
        "tic" {
            return ConvertFrom-TicText (Get-ExactScientificOutputText $Directory) -RequireContiguousIndices
        }
        "tic_ms2" {
            return ConvertFrom-TicText (Get-ExactScientificOutputText $Directory)
        }
        "spectrum_index_0" {
            return ConvertFrom-BinarySpectrumText (Get-ExactScientificOutputText $Directory) 0
        }
        default {
            return [ordered]@{ status = "not_applicable_to_exact_scientific_parser" }
        }
    }
}

function Invoke-HarnessOperation {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string[]]$SanitizedArguments,
        [Parameter(Mandatory = $true)][hashtable]$Account,
        [Parameter(Mandatory = $true)][System.Security.SecureString]$Password,
        [Parameter(Mandatory = $true)][string]$HarnessPath,
        [Parameter(Mandatory = $true)][System.Collections.Generic.IDictionary[string, string]]$Environment,
        [Parameter(Mandatory = $true)][hashtable]$Layout,
        [Parameter(Mandatory = $true)][string]$OutputDirectory,
        [int]$TimeoutMilliseconds = 600000,
        [switch]$AllowPreExecutionFailure
    )
    $result = Invoke-SecureProcess -Account $Account -Password $Password -Application $HarnessPath `
        -Arguments $Arguments -Environment $Environment -Layout $Layout -TimeoutMilliseconds $TimeoutMilliseconds
    $stdoutText = Get-Utf8Text $result.Stdout
    $facts = ConvertFrom-HarnessFacts $stdoutText
    $inventory = Get-OutputInventory $OutputDirectory
    if ($result.TimedOut -or $result.StdoutTruncated -or $result.StderrTruncated -or
        $result.StdoutTotalBytes -ne $result.Stdout.Length -or
        $result.StderrTotalBytes -ne $result.Stderr.Length) {
        Stop-Evidence "operation_capture_incomplete"
    }
    $argvCount = 0
    if (-not $facts.Contains("command.argv_count") -or
        -not [int]::TryParse([string]$facts["command.argv_count"], [ref]$argvCount) -or
        $argvCount -lt 1 -or $argvCount -gt 32) {
        Stop-Evidence "operation_argv_count_invalid"
    }
    for ($index = 0; $index -lt $argvCount; $index++) {
        if (-not $facts.Contains("command.argv[$index]")) {
            Stop-Evidence "operation_argv_evidence_incomplete"
        }
    }
    if (-not $facts.Contains("command_surface.tool") -or
        -not $facts.Contains("command_surface.validated_from_installed_help") -or
        -not $facts.Contains("command_surface.help.stdout_sha256") -or
        -not $facts.Contains("command_surface.help.stderr_sha256") -or
        $facts["command_surface.validated_from_installed_help"] -ne "true") {
        if (-not $AllowPreExecutionFailure) { Stop-Evidence "operation_help_binding_missing" }
    }
    else {
        $toolKey = switch ($facts["command_surface.tool"]) {
            "msaccess" { "msaccess" }
            "msconvert" { "msconvert" }
            default { Stop-Evidence "operation_help_binding_tool_invalid" }
        }
        $expectedHelp = $script:Summary.help[$toolKey]
        if ($facts["command_surface.help.stdout_sha256"] -ne $expectedHelp.stdoutSha256 -or
            $facts["command_surface.help.stderr_sha256"] -ne $expectedHelp.stderrSha256) {
            Stop-Evidence "operation_help_hash_mismatch"
        }
    }
    if ($result.ExitCode -ne 0 -and -not $facts.Contains("process.termination") -and
        -not $AllowPreExecutionFailure) {
        Stop-Evidence "command_grammar_unconfirmed"
    }
    $backendExitCode = Get-NormalizedBackendExitCode $facts
    $privatePayload = $null
    $payloadEvidence = [ordered]@{ status = "not_emitted_pre_execution_failure"; bytes = $null; sha256 = $null }
    if ($stdoutText -match '(?m)^scientific\.stdout_payload_status=') {
        $privatePayload = Get-PrivateScientificStdoutPayload $stdoutText
        $payloadEvidence = [ordered]@{
            status = $privatePayload.status
            bytes = $privatePayload.bytes
            sha256 = $privatePayload.sha256
        }
    }
    elseif (-not $AllowPreExecutionFailure) {
        Stop-Evidence "scientific_stdout_payload_missing"
    }
    try {
        $exactScientific = Get-ExactScientificObservation -Name $Name -Directory $OutputDirectory `
            -Inventory $inventory -BackendExitCode $backendExitCode -PrivatePayload $privatePayload
    }
    catch {
        $parserCode = Get-StableFailureCode $_
        if ($parserCode -match '^(?:metadata_|run_summary_|spectrum_table_|tic_tsv_|binary_spectrum_|exact_scientific_output_)') {
            $exactScientific = [ordered]@{
                status = "C_output_schema_unparsed"
                failureCode = $parserCode
                backendExitCode = $backendExitCode
                rawOutputRetained = $false
            }
        }
        else { throw }
    }
    if ($Name -eq "spectrum_index_0") {
        $binaryArg = @($facts.GetEnumerator() | Where-Object {
            $_.Key -match '^command\.argv\[\d+\]$' -and $_.Value -ceq 'binary index=0 precision=8'
        })
        if ($binaryArg.Count -ne 1) { Stop-Evidence "binary_spectrum_command_precision_invalid" }
    }
    $privatePayload = $null
    $operation = [ordered]@{
        name = $Name
        sanitizedArgv = @($SanitizedArguments)
        harnessExitCode = $result.ExitCode
        backendExitCode = $backendExitCode
        launcherElapsedMs = $result.ElapsedMilliseconds
        timedOut = $result.TimedOut
        captureComplete = $true
        stdoutRetainedBytes = $result.Stdout.Length
        stderrRetainedBytes = $result.Stderr.Length
        stdoutTotalBytes = $result.StdoutTotalBytes
        stderrTotalBytes = $result.StderrTotalBytes
        stdoutTruncated = $result.StdoutTruncated
        stderrTruncated = $result.StderrTruncated
        scientificStdoutEvidence = $payloadEvidence
        harnessFacts = $facts
        output = $inventory
        exactScientific = $exactScientific
    }
    $script:Summary.operations += $operation
    return $operation
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

function Test-ExactScientificObserved {
    param($Operation)
    return $null -ne $Operation -and $null -ne $Operation.exactScientific -and
        ([string]$Operation.exactScientific.status).StartsWith("observed_exact_", [StringComparison]::Ordinal)
}

function Get-MsLevelCount {
    param(
        [Parameter(Mandatory = $true)]$Distribution,
        [Parameter(Mandatory = $true)][int]$MsLevel
    )
    $entry = @($Distribution | Where-Object { $_.msLevel -eq $MsLevel } | Select-Object -First 1)
    if ($entry.Count -eq 0) { return 0L }
    return [int64]$entry[0].spectrumCount
}

function Complete-ScientificCrossChecks {
    param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$InputStructure)
    $runSummary = Get-RecordedOperation "run_summary"
    $spectrumTable = Get-RecordedOperation "spectrum_table"
    $tic = Get-RecordedOperation "tic"
    $filteredTic = Get-RecordedOperation "tic_ms2"
    $selected = Get-RecordedOperation "spectrum_index_0"
    $checks = [ordered]@{
        inputSpectrumCount = [int64]$InputStructure.spectrumCount
        inputChromatogramCount = [int64]$InputStructure.chromatogramCount
        runSummarySpectrumCountMatchesInput = $null
        spectrumTableRowCountMatchesInput = $null
        spectrumTableMatchesRunSummary = $null
        ticRowCountMatchesInput = $null
        ticMatchesRunSummary = $null
        filteredTicAllMs2 = $null
        filteredTicCountMatchesRunSummaryMs2 = $null
        selectedSpectrumMatchesTableIndexAndId = $null
    }
    if (Test-ExactScientificObserved $runSummary) {
        $checks.runSummarySpectrumCountMatchesInput =
            $runSummary.exactScientific.spectrumCount -eq $InputStructure.spectrumCount
    }
    if (Test-ExactScientificObserved $spectrumTable) {
        $checks.spectrumTableRowCountMatchesInput =
            $spectrumTable.exactScientific.rowCount -eq $InputStructure.spectrumCount
        if (Test-ExactScientificObserved $runSummary) {
            $checks.spectrumTableMatchesRunSummary =
                $spectrumTable.exactScientific.rowCount -eq $runSummary.exactScientific.spectrumCount
        }
    }
    if (Test-ExactScientificObserved $tic) {
        $checks.ticRowCountMatchesInput = $tic.exactScientific.rowCount -eq $InputStructure.spectrumCount
        if (Test-ExactScientificObserved $runSummary) {
            $checks.ticMatchesRunSummary = $tic.exactScientific.rowCount -eq $runSummary.exactScientific.spectrumCount
        }
    }
    if (Test-ExactScientificObserved $filteredTic) {
        $distribution = @($filteredTic.exactScientific.msLevelDistribution)
        $checks.filteredTicAllMs2 = $distribution.Count -le 1 -and
            ($distribution.Count -eq 0 -or $distribution[0].msLevel -eq 2)
        if (Test-ExactScientificObserved $runSummary) {
            $checks.filteredTicCountMatchesRunSummaryMs2 = $filteredTic.exactScientific.rowCount -eq
                (Get-MsLevelCount -Distribution $runSummary.exactScientific.msLevelDistribution -MsLevel 2)
        }
    }
    if (Test-ExactScientificObserved $selected -and Test-ExactScientificObserved $spectrumTable) {
        $selectedRelation = $selected.exactScientific.nativeIdIndexRelation
        $tableRelation = $spectrumTable.exactScientific.nativeIdIndexRelation
        $checks.selectedSpectrumMatchesTableIndexAndId = $selectedRelation.reportedIndex -eq 0 -and
            $tableRelation.index -eq 0 -and $selectedRelation.nativeId -ceq $tableRelation.nativeId
    }
    $script:Summary.scientificCrossChecks = $checks
}

function Assert-MatrixExpectations {
    param([Parameter(Mandatory = $true)][string]$ConflictSeedSha256)
    foreach ($name in @(
        "metadata",
        "run_summary",
        "spectrum_table",
        "tic",
        "tic_ms2",
        "spectrum_index_0",
        "spectrum_unavailable",
        "convert_mzml",
        "convert_mzxml",
        "unsupported_input",
        "unwritable_output",
        "output_conflict_contract"
    )) {
        $operation = Get-RecordedOperation $name
        if ($null -eq $operation -or $operation.timedOut -or -not $operation.captureComplete) {
            Stop-Evidence "required_operation_record_incomplete"
        }
    }
    $unwritable = Get-RecordedOperation "unwritable_output"
    if ($unwritable.output.itemCount -ne 0 -or $unwritable.output.fileCount -ne 0) {
        Stop-Evidence "unwritable_output_created_file"
    }
    $conflict = Get-RecordedOperation "output_conflict_contract"
    if ($conflict.output.fileCount -ne 1 -or $conflict.output.files[0].sha256 -ne $ConflictSeedSha256) {
        Stop-Evidence "output_conflict_sentinel_changed"
    }
    $script:Summary.matrixExpectations = [ordered]@{
        requiredOperationRecordsComplete = $true
        backendCapabilityFailuresRetainedAsEvidence = $true
        unavailableSpectrumIsObservational = $true
        unavailableSpectrumBackendExitCode = (Get-RecordedOperation "spectrum_unavailable").backendExitCode
        outputConflictSentinelPreserved = $true
        unwritableOutputCreatedNoFile = $true
        unsupportedInputOutcome = Get-OperationOutcome "unsupported_input"
    }
}

function Complete-ScientificFindings {
    $metadata = Get-RecordedOperation "metadata"
    $runSummary = Get-RecordedOperation "run_summary"
    $spectrumTable = Get-RecordedOperation "spectrum_table"
    $tic = Get-RecordedOperation "tic"
    $filteredTic = Get-RecordedOperation "tic_ms2"
    $spectrum = Get-RecordedOperation "spectrum_index_0"
    $script:Summary.scientificFindings = [ordered]@{
        metadata = $metadata.exactScientific
        runSummary = $runSummary.exactScientific
        chromatogramCount = [ordered]@{
            status = "observed_external_secure_fixture_xml"
            value = $script:Summary.fixtureStructure.chromatogramCount
            msaccessRunSummaryField = "D_not_emitted"
        }
        spectrumTable = $spectrumTable.exactScientific
        tic = $tic.exactScientific
        filteredTicMs2 = $filteredTic.exactScientific
        selectedSpectrum = $spectrum.exactScientific
        evidenceRetention = [ordered]@{
            completeGeneratedFileHashesRetained = $true
            rawOrRowLevelScientificExcerptsRetained = $false
            onlyStructuredCountsRangesAndDigestsRetained = $true
            rawGeneratedScientificFilesUploaded = $false
            rawBackendStreamsUploaded = $false
            unparsedFieldsRemainD = $true
        }
    }
}

function New-CapabilityAssessment {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("A", "B", "C", "D")][string]$Rating,
        [Parameter(Mandatory = $true)][string]$Basis,
        [Parameter(Mandatory = $true)][string]$Limits
    )
    return [ordered]@{ rating = $Rating; basis = $Basis; limits = $Limits }
}

function Get-ParsedOperationAssessment {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][ValidateSet("A", "B")][string]$SuccessRating,
        [Parameter(Mandatory = $true)][string]$SuccessBasis,
        [Parameter(Mandatory = $true)][string]$SuccessLimits
    )
    $operation = Get-RecordedOperation $Name
    if ($null -eq $operation) {
        return New-CapabilityAssessment "D" "operation was not run" "no runtime evidence"
    }
    if ($operation.backendExitCode -ne 0 -or -not (Test-ExactScientificObserved $operation)) {
        return New-CapabilityAssessment "C" "backend or exact output schema was unsuitable in this run" `
            "see the sanitized operation outcome and hashes"
    }
    return New-CapabilityAssessment $SuccessRating $SuccessBasis $SuccessLimits
}

function Add-ScientificCrossCheckGate {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Assessment,
        [Parameter(Mandatory = $true)][string]$Capability,
        [Parameter(Mandatory = $true)][string[]]$CheckNames
    )
    if ($Assessment.rating -in @("C", "D")) { return $Assessment }
    $checks = $script:Summary.scientificCrossChecks
    foreach ($name in $CheckNames) {
        if ($null -eq $checks -or -not $checks.Contains($name) -or $null -eq $checks[$name]) {
            return New-CapabilityAssessment "D" "$Capability cross-check was unavailable" `
                "see scientificCrossChecks and sanitized operation outcomes"
        }
        if ($checks[$name] -ne $true) {
            return New-CapabilityAssessment "C" "$Capability contradicted an independent scientific cross-check" `
                "see scientificCrossChecks and sanitized operation outcomes"
        }
    }
    return $Assessment
}

function Complete-CapabilityOutcomes {
    $conversionMzMl = $script:Summary.operations | Where-Object { $_.name -eq "convert_mzml" } | Select-Object -Last 1
    $conversionMzXml = $script:Summary.operations | Where-Object { $_.name -eq "convert_mzxml" } | Select-Object -Last 1
    $cancellation = $script:Summary.operations | Where-Object { $_.name -eq "conversion_cancellation" } | Select-Object -Last 1
    $cancellationOutcome = "not_measurable"
    if ($null -ne $cancellation -and
        $cancellation.harnessFacts.Contains("process.termination") -and
        $cancellation.harnessFacts["process.termination"] -match '(?i)cancel') {
        $cancellationOutcome = "observed_cancelled"
    }
    $script:Summary.operationOutcomes = [ordered]@{
        discoveryAndBuildIdentity = "observed_success"
        metadata = Get-OperationOutcome "metadata"
        summaryAndCounts = Get-OperationOutcome "run_summary"
        tic = Get-OperationOutcome "tic"
        filteredTic = Get-OperationOutcome "tic_ms2"
        bpc = $script:Summary.help.msaccess.bpcConclusion
        scanListing = Get-OperationOutcome "spectrum_table"
        selectedSpectrum = Get-OperationOutcome "spectrum_index_0"
        unavailableSpectrum = Get-OperationOutcome "spectrum_unavailable"
        conversionMzMl = $(if ($null -eq $conversionMzMl) { "not_run" } else { $conversionMzMl.finalConversionValidation.status })
        conversionMzXml = $(if ($null -eq $conversionMzXml) { "not_run" } else { $conversionMzXml.finalConversionValidation.status })
        progress = "not_measured_no_stream_timestamps"
        cancellation = $cancellationOutcome
        localeComparison = "not_run_no_safe_per_user_culture_change"
        vendorCoverage = "not_run_by_scope"
    }
    $mzMlAssessment = if ($null -eq $conversionMzMl) {
        New-CapabilityAssessment "D" "mzML conversion was not run" "no runtime evidence"
    }
    elseif ($conversionMzMl.backendExitCode -ne 0 -or
        $conversionMzMl.finalConversionValidation.status -ne "valid") {
        New-CapabilityAssessment "C" "mzML conversion or external validation was unsuitable" `
            "see finalConversionValidation"
    }
    else {
        New-CapabilityAssessment "B" "mzML conversion passed secure structure and per-array zlib validation" `
            "one tiny synthetic open-format fixture; no archival or losslessness claim"
    }
    $mzXmlAssessment = if ($null -eq $conversionMzXml) {
        New-CapabilityAssessment "D" "mzXML conversion was not run" "no runtime evidence"
    }
    elseif ($conversionMzXml.backendExitCode -ne 0 -or
        $conversionMzXml.finalConversionValidation.status -notin @("valid", "valid_with_expected_chromatogram_loss")) {
        New-CapabilityAssessment "C" "mzXML conversion or external validation was unsuitable" `
            "see finalConversionValidation"
    }
    else {
        New-CapabilityAssessment "B" "mzXML conversion passed secure structure and per-array zlib validation" `
            "mzXML cannot serialize fixture chromatograms; one tiny synthetic fixture; no equivalence claim"
    }
    $cancellationAssessment = if ($cancellationOutcome -eq "observed_cancelled") {
        New-CapabilityAssessment "B" "real backend cancellation was observed" "tiny-fixture timing only"
    }
    else { New-CapabilityAssessment "D" "real cancellation was not measurable" "job-object tests are contract evidence only" }
    $bpcAssessment = if ($script:Summary.help.msaccess.bpcQueryDeclared) {
        New-CapabilityAssessment "D" "installed help declared a literal BPC query, but it was not executed" `
            "execution remains unverified"
    }
    else {
        New-CapabilityAssessment "D" "literal BPC query was absent from installed help" `
            "equivalent capability remains unverified"
    }
    $capabilityTable = [ordered]@{
        discoveryBuildIdentity = New-CapabilityAssessment "A" `
            "exact executable hashes, complete help, and compatible reported identities were verified" `
            "portable open-format build only"
        metadata = Get-ParsedOperationAssessment "metadata" "B" `
            "exact metadata section schema, file hash, and byte count were observed" `
            "metadata values are intentionally not retained"
        summaryCounts = Get-ParsedOperationAssessment "run_summary" "B" `
            "exact complete stdout TSV provided spectrum/MS-level counts and RT range" `
            "run_summary omits chromatogram count and RT units"
        tic = Get-ParsedOperationAssessment "tic" "A" `
            "exact TIC TSV schema, rows, ranges, and digest were observed" `
            "single tiny synthetic fixture"
        filteredTic = Get-ParsedOperationAssessment "tic_ms2" "A" `
            "installed help confirmed the exact filter and all observed rows were checked" `
            "MS2-only filter on one tiny synthetic fixture"
        bpc = $bpcAssessment
        scanListing = Get-ParsedOperationAssessment "spectrum_table" "A" `
            "exact spectrum-table schema and native ID/index relation were observed" `
            "single tiny synthetic fixture"
        selectedSpectrum = Get-ParsedOperationAssessment "spectrum_index_0" "B" `
            "exact binary formatter schema, matching arrays, precision bound, and digests were observed" `
            "units and profile/centroid markers are not emitted by this query"
        repeatedNavigation = New-CapabilityAssessment "D" "repeated navigation was not run" `
            "outside this bounded one-shot evidence matrix"
        largeArrays = New-CapabilityAssessment "D" "large arrays were not run" `
            "tiny synthetic fixture only"
        conversion = New-CapabilityAssessment `
            $(if ($mzMlAssessment.rating -eq "C" -and $mzXmlAssessment.rating -eq "C") { "C" } else { "B" }) `
            "format-specific external XML, structure, and compression validation was recorded" `
            "tiny open-format fixture; mzXML chromatogram loss; no archival, vendor, or losslessness claim"
        conversionMzML = $mzMlAssessment
        conversionMzXML = $mzXmlAssessment
        progress = New-CapabilityAssessment "D" "stream cadence was not timestamped" `
            "no machine-readable progress claim"
        cancellation = $cancellationAssessment
        localeStability = New-CapabilityAssessment "D" "a second safe per-user locale was not run" `
            "default runner locale only"
        vendorCoverage = New-CapabilityAssessment "D" "vendor input was excluded by scope" `
            "no vendor RAW evidence"
    }
    $capabilityTable.summaryCounts = Add-ScientificCrossCheckGate $capabilityTable.summaryCounts `
        "summary/counts" @("runSummarySpectrumCountMatchesInput")
    $capabilityTable.scanListing = Add-ScientificCrossCheckGate $capabilityTable.scanListing `
        "scan listing" @("spectrumTableRowCountMatchesInput", "spectrumTableMatchesRunSummary")
    $capabilityTable.tic = Add-ScientificCrossCheckGate $capabilityTable.tic `
        "TIC" @("ticRowCountMatchesInput", "ticMatchesRunSummary")
    $capabilityTable.filteredTic = Add-ScientificCrossCheckGate $capabilityTable.filteredTic `
        "filtered TIC" @("filteredTicAllMs2", "filteredTicCountMatchesRunSummaryMs2")
    $capabilityTable.selectedSpectrum = Add-ScientificCrossCheckGate $capabilityTable.selectedSpectrum `
        "selected spectrum" @("selectedSpectrumMatchesTableIndexAndId")
    $script:Summary.capabilityTable = $capabilityTable
    $script:Summary.capabilityOutcomes = $capabilityTable
}

function New-SummaryMarkdown {
    param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$Summary)
    $builder = [System.Text.StringBuilder]::new()
    [void]$builder.AppendLine("# MSCanvas M0B isolated ProteoWizard evidence")
    [void]$builder.AppendLine()
    [void]$builder.AppendLine("- Status: ``$($Summary.status)``")
    [void]$builder.AppendLine("- Source commit: ``$($Summary.sourceSha)``")
    [void]$builder.AppendLine("- Runner request: ``windows-2025``")
    [void]$builder.AppendLine("- Portable archive identity verified: ``$($Summary.provenance.archive.verified)``")
    [void]$builder.AppendLine("- Synthetic fixture identity verified: ``$($Summary.provenance.fixture.verified)``")
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
    [void]$builder.AppendLine("| Operation | Backend exit | Harness exit | Final validation | Elapsed ms | Output files |")
    [void]$builder.AppendLine("| --- | ---: | ---: | --- | ---: | ---: |")
    foreach ($operation in $Summary.operations) {
        $backendOutcome = if ($null -eq $operation.backendExitCode) { "not available" }
            else { [string]$operation.backendExitCode }
        $finalValidation = if ($operation.Contains("finalConversionValidation")) {
            $operation.finalConversionValidation.status
        }
        else { "not applicable" }
        [void]$builder.AppendLine("| $($operation.name) | $backendOutcome | $($operation.harnessExitCode) | $finalValidation | $($operation.launcherElapsedMs) | $($operation.output.fileCount) |")
    }
    [void]$builder.AppendLine()
    [void]$builder.AppendLine("## Scope limits")
    [void]$builder.AppendLine()
    [void]$builder.AppendLine("BPC execution, a second locale, vendor input, repeated navigation, large arrays, and realistic-performance claims remain outside this evidence run unless explicitly recorded above. Conversion validity is assigned only by the external SHA-256 and secure XML/structure checks, never by the harness candidate-file label alone.")
    return $builder.ToString()
}

function Get-ForbiddenEvidencePatterns {
    return @(
        '(?i)(?<![A-Za-z0-9])[a-z]:[\\/]',
        '(?i)file:(?:[\\/]|\\[\\/])+',
        '(?i)\\\\[^<\s][^\\\s]*\\',
        '(?i)scientific\.stdout_base64',
        '(?i)GITHUB_',
        '(?i)ACTIONS_',
        '(?i)(github_pat_|gh[opsu]_|bearer\s+|authorization\s*[:=]|password\s*[:=]|credential\s*[:=])'
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
    if ([System.IO.Path]::GetFileName($fullPublish) -ne "m0b-publish") {
        Stop-Evidence "publish_root_name_invalid"
    }
    if ([System.IO.Directory]::Exists($fullPublish) -or [System.IO.File]::Exists($fullPublish)) {
        Stop-Evidence "publish_root_preexisting"
    }

    $pair = New-SanitizedEvidencePair -Summary $Summary -SensitiveValues $SensitiveValues
    $stagingName = "m0b-publish-staging-" + [Guid]::NewGuid().ToString('N')
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
    if ([System.IO.Path]::GetFileName($publishFull) -ne "m0b-publish") {
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
        $script:PublishRoot = Join-Path $root "m0b-publish"
        $sensitiveValues = @("m0b-sensitive-machine", "runneradmin")
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
        if ($stableLog -notmatch '(?m)^M0B publication blocked stage=publish_sanitized_evidence code=evidence_content_scan_failed$' -or
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
        if (Get-ChildItem -LiteralPath $root -Directory -Filter "m0b-publish-staging-*" |
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
        Write-Host "M0B cleanup private state was unavailable; teardown could not be attested."
        return 1
    }
    try {
        $stateFull = Assert-FullPathUnder -Candidate $StatePath -Parent $env:RUNNER_TEMP `
            -FailureCode "cleanup_state_outside_runner_temp"
        if ([System.IO.Path]::GetFileName($stateFull) -ne "m0b-state.json") {
            Stop-Evidence "cleanup_state_name_invalid"
        }
        $state = Get-Content -Raw -LiteralPath $stateFull | ConvertFrom-Json
    }
    catch {
        Write-Host "M0B cleanup could not validate its private state."
        return 1
    }

    $attestation = [ordered]@{
        allRuntimeProcessesAbsent = $false
        firewallRulesAbsent = $false
        temporaryProfileAbsent = $false
        temporaryUserAbsent = $false
        remoteInteractiveDenyRightCleaned = $false
        runtimeRootAbsent = $false
        privateStateRemoved = $false
        cleanupComplete = $false
        failureCode = "cleanup_in_progress"
    }
    $sensitiveValues = @($env:COMPUTERNAME, $env:USERNAME, [string]$state.username)
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
            if ([string]$ruleName -notmatch '^M0B-[0-9a-f]{32}-(msconvert|msaccess|harness)$') {
                Stop-Evidence "cleanup_firewall_rule_name_invalid"
            }
            $existing = Get-NetFirewallRule -Name ([string]$ruleName) -PolicyStore ActiveStore `
                -ErrorAction SilentlyContinue
            if ($null -ne $existing) {
                $existingRules = @($existing)
                if ($existingRules.Count -ne 1 -or
                    $existingRules[0].DisplayName -cne "MSCanvas disposable M0B outbound block" -or
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
    if ([System.IO.Path]::GetFileName($stateFull) -ne "m0b-state.json" -or [System.IO.File]::Exists($stateFull)) {
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

    $archivePath = Join-Path $env:RUNNER_TEMP ("m0b-archive-" + [Guid]::NewGuid().ToString('N') + ".tar.bz2")
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
        Add-VerifiedFirewallRule -RuleName "M0B-$ruleNonce-msconvert" -ProgramPath $tools.msconvert -State $state
        Write-Stage "install_firewall_block_msaccess"
        Add-VerifiedFirewallRule -RuleName "M0B-$ruleNonce-msaccess" -ProgramPath $tools.msaccess -State $state
        Write-Stage "install_firewall_block_harness"
        Add-VerifiedFirewallRule -RuleName "M0B-$ruleNonce-harness" -ProgramPath $harnessPath -State $state
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

        Write-Stage "measure_open_format_operations"
        $script:OperationIndex = 0
        $inputStructure = Get-XmlStructure $fixturePath
        if ($inputStructure.root -notin @("mzML", "indexedmzML") -or $inputStructure.spectrumCount -le 0) {
            Stop-Evidence "fixture_xml_structure_invalid"
        }
        $script:Summary.fixtureStructure = $inputStructure
        $operationPlans = @(
            @{ name = "metadata"; mode = "metadata" },
            @{ name = "run_summary"; mode = "run-summary" },
            @{ name = "spectrum_table"; mode = "spectrum-table" },
            @{ name = "tic"; mode = "tic" }
        )
        foreach ($plan in $operationPlans) {
            $output = New-OperationDirectory -Layout $layout -Name $plan.name
            $arguments = @("--mode", $plan.mode, "--proteowizard-home", $tools.portableRoot,
                "--input", $fixturePath, "--output-dir", $output)
            $sanitized = @("--mode", $plan.mode, "--proteowizard-home", "<portable-root>",
                "--input", "<fixture>", "--output-dir", "<output-root>/$($plan.name)")
            [void](Invoke-HarnessOperation -Name $plan.name -Arguments $arguments `
                -SanitizedArguments $sanitized -Account $account -Password $password `
                -HarnessPath $harnessPath -Environment $environment -Layout $layout -OutputDirectory $output)
        }

        $filteredTicOutput = New-OperationDirectory -Layout $layout -Name "tic_ms2"
        $filteredTic = Invoke-HarnessOperation -Name "tic_ms2" `
            -Arguments @("--mode", "tic", "--proteowizard-home", $tools.portableRoot,
                "--input", $fixturePath, "--output-dir", $filteredTicOutput, "--ms-level", "2") `
            -SanitizedArguments @("--mode", "tic", "--proteowizard-home", "<portable-root>",
                "--input", "<fixture>", "--output-dir", "<output-root>/tic_ms2", "--ms-level", "2") `
            -Account $account -Password $password -HarnessPath $harnessPath -Environment $environment `
            -Layout $layout -OutputDirectory $filteredTicOutput
        if (-not $filteredTic.harnessFacts.Contains("command_surface.tic_capability") -or
            $filteredTic.harnessFacts["command_surface.tic_capability"] -ne "SupportedWithMsLevelFilter") {
            Stop-Evidence "filtered_tic_capability_not_exact"
        }

        foreach ($spectrumPlan in @(
            @{ name = "spectrum_index_0"; index = "0" },
            @{ name = "spectrum_unavailable"; index = "18446744073709551615" }
        )) {
            $output = New-OperationDirectory -Layout $layout -Name $spectrumPlan.name
            $arguments = @("--mode", "spectrum", "--proteowizard-home", $tools.portableRoot,
                "--input", $fixturePath, "--output-dir", $output, "--spectrum-index", $spectrumPlan.index)
            $sanitized = @("--mode", "spectrum", "--proteowizard-home", "<portable-root>",
                "--input", "<fixture>", "--output-dir", "<output-root>/$($spectrumPlan.name)",
                "--spectrum-index", $spectrumPlan.index)
            [void](Invoke-HarnessOperation -Name $spectrumPlan.name -Arguments $arguments `
                -SanitizedArguments $sanitized -Account $account -Password $password `
                -HarnessPath $harnessPath -Environment $environment -Layout $layout -OutputDirectory $output)
        }

        $conversionOperations = @{}
        foreach ($formatPlan in @(
            @{ name = "convert_mzml"; format = "mzML" },
            @{ name = "convert_mzxml"; format = "mzXML" }
        )) {
            $output = New-OperationDirectory -Layout $layout -Name $formatPlan.name
            $arguments = @("--mode", "convert", "--proteowizard-home", $tools.portableRoot,
                "--input", $fixturePath, "--output-dir", $output, "--format", $formatPlan.format)
            $sanitized = @("--mode", "convert", "--proteowizard-home", "<portable-root>",
                "--input", "<fixture>", "--output-dir", "<output-root>/$($formatPlan.name)",
                "--format", $formatPlan.format)
            $operation = Invoke-HarnessOperation -Name $formatPlan.name -Arguments $arguments `
                -SanitizedArguments $sanitized -Account $account -Password $password `
                -HarnessPath $harnessPath -Environment $environment -Layout $layout -OutputDirectory $output
            $validation = Test-ConversionOutput -Directory $output -Format $formatPlan.format `
                -InputStructure $inputStructure
            if ($operation.backendExitCode -ne 0 -and
                $validation.status -in @("valid", "valid_with_expected_chromatogram_loss")) {
                $validation.status = "backend_failure_with_output"
            }
            $operation["finalConversionValidation"] = $validation
            $operation["harnessCandidateLabelIsNotFinalValidity"] = $true
            $conversionOperations[$formatPlan.name] = $operation
        }

        $malformedOutput = New-OperationDirectory -Layout $layout -Name "unsupported_input"
        $malformedPath = Join-Path $layout.fixture "unsupported-open-input.txt"
        [void](Invoke-HarnessOperation -Name "unsupported_input" `
            -Arguments @("--mode", "metadata", "--proteowizard-home", $tools.portableRoot,
                "--input", $malformedPath, "--output-dir", $malformedOutput) `
            -SanitizedArguments @("--mode", "metadata", "--proteowizard-home", "<portable-root>",
                "--input", "<fixture:unsupported>", "--output-dir", "<output-root>/unsupported_input") `
            -Account $account -Password $password -HarnessPath $harnessPath -Environment $environment `
            -Layout $layout -OutputDirectory $malformedOutput)

        $conflictOutput = New-OperationDirectory -Layout $layout -Name "output_conflict_contract"
        $conflictSeedPath = Join-Path $conflictOutput "existing.txt"
        [System.IO.File]::WriteAllText($conflictSeedPath, "controlled-conflict")
        $conflictSeedSha256 = Get-UpperSha256 $conflictSeedPath
        [void](Invoke-HarnessOperation -Name "output_conflict_contract" `
            -Arguments @("--mode", "convert", "--proteowizard-home", $tools.portableRoot,
                "--input", $fixturePath, "--output-dir", $conflictOutput, "--format", "mzML") `
            -SanitizedArguments @("--mode", "convert", "--proteowizard-home", "<portable-root>",
                "--input", "<fixture>", "--output-dir", "<output-root>/output_conflict_contract", "--format", "mzML") `
            -Account $account -Password $password -HarnessPath $harnessPath -Environment $environment `
            -Layout $layout -OutputDirectory $conflictOutput -AllowPreExecutionFailure)

        $unwritableOutput = New-OperationDirectory -Layout $layout -Name "unwritable_output"
        Set-RuntimeDirectoryAcl -LiteralPath $unwritableOutput -TemporarySid $account.sid `
            -TemporaryRights ([System.Security.AccessControl.FileSystemRights]::ReadAndExecute)
        Assert-RuntimeDirectoryAcl -LiteralPath $unwritableOutput -TemporarySid $account.sid -AccessClass Read
        [void](Invoke-HarnessOperation -Name "unwritable_output" `
            -Arguments @("--mode", "convert", "--proteowizard-home", $tools.portableRoot,
                "--input", $fixturePath, "--output-dir", $unwritableOutput, "--format", "mzML") `
            -SanitizedArguments @("--mode", "convert", "--proteowizard-home", "<portable-root>",
                "--input", "<fixture>", "--output-dir", "<output-root>/unwritable_output", "--format", "mzML") `
            -Account $account -Password $password -HarnessPath $harnessPath -Environment $environment `
            -Layout $layout -OutputDirectory $unwritableOutput)

        $mzmlElapsedText = $conversionOperations["convert_mzml"].harnessFacts["process.elapsed_ms"]
        $mzmlElapsed = 0L
        if ($null -ne $mzmlElapsedText) { [void][int64]::TryParse([string]$mzmlElapsedText, [ref]$mzmlElapsed) }
        if ($mzmlElapsed -ge 500) {
            $cancelOutput = New-OperationDirectory -Layout $layout -Name "conversion_cancellation"
            [void](Invoke-HarnessOperation -Name "conversion_cancellation" `
                -Arguments @("--mode", "convert", "--proteowizard-home", $tools.portableRoot,
                    "--input", $fixturePath, "--output-dir", $cancelOutput, "--format", "mzML",
                    "--cancel-after-ms", "100") `
                -SanitizedArguments @("--mode", "convert", "--proteowizard-home", "<portable-root>",
                    "--input", "<fixture>", "--output-dir", "<output-root>/conversion_cancellation",
                    "--format", "mzML", "--cancel-after-ms", "100") `
                -Account $account -Password $password -HarnessPath $harnessPath -Environment $environment `
                -Layout $layout -OutputDirectory $cancelOutput)
        }

        $fixtureFinalItem = Get-Item -LiteralPath $fixturePath
        if ([int64]$fixtureFinalItem.Length -ne $FixtureBytes -or
            (Get-UpperSha256 $fixturePath) -ne $FixtureSha256) {
            Stop-Evidence "fixture_changed_during_measurement"
        }
        $script:Summary.provenance.fixture.sourceUnchangedAfterMatrix = $true
        Assert-MatrixExpectations -ConflictSeedSha256 $conflictSeedSha256
        Complete-ScientificCrossChecks -InputStructure $inputStructure
        Complete-ScientificFindings
        Complete-CapabilityOutcomes
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

if ($Mode -eq "SelfTest") {
    $selfTestBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $selfTestRoot = Join-Path $selfTestBase ("mscanvas-m0b-selftest-" + [Guid]::NewGuid().ToString('N'))
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

$script:CurrentStage = "initialize"
$script:Summary = [ordered]@{
    schemaVersion = 1
    status = "running"
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
    failure = $null
}

$runExitCode = 0
try {
    Invoke-EvidenceRun
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
try {
    $publication = Publish-SanitizedEvidence -Summary $script:Summary -SensitiveValues $sensitiveValues
    if (-not $publication.fullSummaryPublished) { $runExitCode = 1 }
}
catch {
    $runExitCode = 1
}
exit $runExitCode
