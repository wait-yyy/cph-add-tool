// tools/_runner.cpp -- tiny process runner used by tools/_common.ps1
//
// Why this exists: on this machine (Windows + PowerShell 5.1 + sandbox), the usual
// PowerShell ways to run a compiled solution are unreliable:
//   * Start-Process -PassThru: child ExitCode is unreadable (access denied)
//   * taskkill / Wait-Process: cannot touch processes we did not create
//   * .NET redirected stdin: writes are buffered in-proc (no delivery until close)
// This runner opens the input/output files natively, passes the handles to the child,
// enforces the time limit with TerminateProcess on our own process handle, and reports
// the real exit code. Paths are taken from GetCommandLineW so non-ASCII (Chinese) paths
// survive (the workspace path contains 算竞).
//
// usage: _runner.exe <exe> <in> <out> <err> <limitMs> <statusFile> [childArg...]
// status file gets lines: timeout=0|1  exit=N  ms=N  [error=...]
// runner itself exits 0 unless its own arguments/handles are broken.

#include <windows.h>
#include <shellapi.h>
#include <cstdio>
#include <string>

static std::wstring QuoteArg(const std::wstring &s) {
    if (s.find_first_of(L" \t") == std::wstring::npos) return s;
    std::wstring r = L"\"";
    for (wchar_t c : s) {
        if (c == L'"') r += L'\\';
        r += c;
    }
    r += L'"';
    return r;
}

static HANDLE OpenInheritable(const std::wstring &path, DWORD access, DWORD disposition) {
    SECURITY_ATTRIBUTES sa;
    sa.nLength = sizeof(sa);
    sa.lpSecurityDescriptor = NULL;
    sa.bInheritHandle = TRUE;
    return CreateFileW(path.c_str(), access, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                       &sa, disposition, FILE_ATTRIBUTE_NORMAL, NULL);
}

static void WriteStatus(const std::wstring &path, const char *text) {
    HANDLE h = CreateFileW(path.c_str(), GENERIC_WRITE, FILE_SHARE_READ, NULL,
                           CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) return;
    DWORD wrote = 0;
    WriteFile(h, text, (DWORD)strlen(text), &wrote, NULL);
    CloseHandle(h);
}

int main() {
    int argc = 0;
    LPWSTR *argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    if (!argv || argc < 7) {
        if (argv) LocalFree(argv);
        return 2;
    }
    std::wstring exe = argv[1];
    std::wstring inPath = argv[2];
    std::wstring outPath = argv[3];
    std::wstring errPath = argv[4];
    unsigned long limitMs = (unsigned long)_wtoi(argv[5]);
    if (limitMs == 0) limitMs = 10000;
    std::wstring statusPath = argv[6];
    // child command line: quoted exe + any extra argv (e.g. generator seed)
    std::wstring cmdLine = QuoteArg(exe);
    for (int i = 7; i < argc; i++) {
        cmdLine += L' ';
        cmdLine += QuoteArg(argv[i]);
    }
    LocalFree(argv);

    HANDLE hIn = OpenInheritable(inPath, GENERIC_READ, OPEN_EXISTING);
    HANDLE hOut = OpenInheritable(outPath, GENERIC_WRITE, CREATE_ALWAYS);
    HANDLE hErr = OpenInheritable(errPath, GENERIC_WRITE, CREATE_ALWAYS);
    if (hIn == INVALID_HANDLE_VALUE || hOut == INVALID_HANDLE_VALUE || hErr == INVALID_HANDLE_VALUE) {
        char buf[256];
        sprintf_s(buf, "timeout=0\nexit=-1\nms=0\nerror=open io files failed (in=%d out=%d err=%d)\n",
                  hIn == INVALID_HANDLE_VALUE, hOut == INVALID_HANDLE_VALUE, hErr == INVALID_HANDLE_VALUE);
        WriteStatus(statusPath, buf);
        if (hIn != INVALID_HANDLE_VALUE) CloseHandle(hIn);
        if (hOut != INVALID_HANDLE_VALUE) CloseHandle(hOut);
        if (hErr != INVALID_HANDLE_VALUE) CloseHandle(hErr);
        return 3;
    }

    STARTUPINFOW si;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput = hIn;
    si.hStdOutput = hOut;
    si.hStdError = hErr;
    PROCESS_INFORMATION pi;
    ZeroMemory(&pi, sizeof(pi));

    // Without this, a crashing child pops the Windows Error Reporting wait (~3s),
    // which would look like a TLE instead of a fast RE.
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX);
    LARGE_INTEGER freq, t0, t1;
    QueryPerformanceFrequency(&freq);
    QueryPerformanceCounter(&t0);

    BOOL ok = CreateProcessW(exe.c_str(), &cmdLine[0], NULL, NULL, TRUE,
                             CREATE_NO_WINDOW, NULL, NULL, &si, &pi);
    if (!ok) {
        char buf[256];
        sprintf_s(buf, "timeout=0\nexit=-1\nms=0\nerror=CreateProcessW failed: %lu\n", GetLastError());
        WriteStatus(statusPath, buf);
        CloseHandle(hIn);
        CloseHandle(hOut);
        CloseHandle(hErr);
        return 3;
    }

    DWORD waitResult = WaitForSingleObject(pi.hProcess, limitMs);
    int timedOut = (waitResult == WAIT_TIMEOUT) ? 1 : 0;
    if (timedOut) {
        TerminateProcess(pi.hProcess, 0xDEADu);
        WaitForSingleObject(pi.hProcess, 3000);
    }
    QueryPerformanceCounter(&t1);
    unsigned long long ms = (unsigned long long)((t1.QuadPart - t0.QuadPart) * 1000 / freq.QuadPart);

    DWORD exitCode = 0;
    GetExitCodeProcess(pi.hProcess, &exitCode);

    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    CloseHandle(hIn);
    CloseHandle(hOut);
    CloseHandle(hErr);

    char buf[256];
    sprintf_s(buf, "timeout=%d\nexit=%lu\nms=%llu\n", timedOut, (unsigned long)exitCode, ms);
    WriteStatus(statusPath, buf);
    return 0;
}
