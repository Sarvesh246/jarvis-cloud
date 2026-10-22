"""One disposable Linux interpreter; no untrusted code runs before confinement."""
import ctypes
import ctypes.util
import json
import resource
import sys
import sysconfig

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
                     "getpid", "gettid", "gettimeofday", "exit", "exit_group"):
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
    javascript=payload.get('language')=='javascript'
    engine=None
    if javascript:
        # -I -S excludes site initialization and user configuration. Add only
        # this interpreter's trusted package locations before confinement.
        sys.path.extend({sysconfig.get_path('purelib'),sysconfig.get_path('platlib')})
        try:
            import quickjs
        except ImportError:
            print('JavaScript runtime unavailable; no submitted code was executed.',flush=True)
            raise SystemExit(78)
        engine=quickjs.Context()
        engine.set_memory_limit(64*1024*1024)
        engine.set_time_limit(1.5)
        engine.set_max_stack_size(512*1024)
        source,tests=payload['source'],payload['tests']
    else:
        source = compile(payload["source"], "<submitted-code>", "exec")
        tests = compile(payload["tests"], "<submitted-tests>", "exec")
    resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
    resource.setrlimit(resource.RLIMIT_AS, (192 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_FSIZE, (32_768,) * 2)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    # Read and close stdin before confinement. Only stdout/stderr are inherited.
    sys.stdin.close()
    try:
        confine()
    except RuntimeError:
        print('Isolation unavailable; no submitted code was executed.',flush=True)
        raise SystemExit(78)
    namespace = {"__name__": "__main__"}
    try:
        if javascript:
            engine.eval(source)
            engine.eval('var __vaelo_test_result = (0,eval)(' + json.dumps(tests) + ');'
                        'if (__vaelo_test_result && typeof __vaelo_test_result.then === "function") '
                        'throw new Error("Asynchronous test results are unsupported; use synchronous assertions.");')
        else:
            exec(source, namespace)
            exec(tests, namespace)
    except BaseException as error:
        print(type(error).__name__ + ": " + str(error), flush=True)
        raise SystemExit(1)
    print("\nVerification completed.", flush=True)
    print('\nVAELO_VERIFIED_' + payload['completion_token'],flush=True)


if __name__ == "__main__":
    main()
