"""One disposable Linux interpreter; no untrusted code runs before confinement."""
import ctypes
import ctypes.util
import json
import resource
import sys

# Load useful standard-library modules before filesystem access is removed.
import bisect, collections, datetime, decimal, fractions, functools, heapq
import itertools, math, random, re, statistics, typing, unittest


def confine():
    library = ctypes.util.find_library("seccomp")
    if not library:
        raise RuntimeError("libseccomp is unavailable")
    seccomp = ctypes.CDLL(library, use_errno=True)
    seccomp.seccomp_init.argtypes = [ctypes.c_uint32]
    seccomp.seccomp_init.restype = ctypes.c_void_p
    seccomp.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    seccomp.seccomp_syscall_resolve_name.restype = ctypes.c_int
    seccomp.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    seccomp.seccomp_load.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_release.argtypes = [ctypes.c_void_p]
    # Kill on every syscall except the minimal interpreter/memory/stdio set.
    ctx = seccomp.seccomp_init(0x80000000)  # SCMP_ACT_KILL_PROCESS
    if not ctx:
        raise RuntimeError("Cannot initialize seccomp")
    try:
        for name in ("read", "write", "close", "fstat", "lseek", "brk", "mmap", "munmap",
                     "mprotect", "mremap", "madvise", "futex", "clock_gettime", "getrandom",
                     "rt_sigaction", "rt_sigprocmask", "rt_sigreturn", "sigaltstack",
                     "getpid", "gettid", "exit", "exit_group"):
            number = seccomp.seccomp_syscall_resolve_name(name.encode())
            if number >= 0 and seccomp.seccomp_rule_add(ctx, 0x7fff0000, number, 0) != 0:
                raise RuntimeError("Cannot install syscall rule")
        # seccomp_load enables no_new_privs by default; failure never falls back.
        if seccomp.seccomp_load(ctx) != 0:
            raise RuntimeError("Cannot load seccomp")
    finally:
        seccomp.seccomp_release(ctx)


def main():
    payload = json.loads(sys.stdin.buffer.read(50_001))
    source = compile(payload["source"], "<submitted-code>", "exec")
    tests = compile(payload["tests"], "<submitted-tests>", "exec")
    resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
    resource.setrlimit(resource.RLIMIT_AS, (192 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_FSIZE, (32_768,) * 2)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    # Read and close stdin before confinement. Only stdout/stderr are inherited.
    sys.stdin.close()
    confine()
    namespace = {"__name__": "__main__"}
    try:
        exec(source, namespace)
        exec(tests, namespace)
    except BaseException as error:
        print(type(error).__name__ + ": " + str(error), flush=True)
        raise SystemExit(1)
    print("\nVerification completed.", flush=True)


if __name__ == "__main__":
    main()
