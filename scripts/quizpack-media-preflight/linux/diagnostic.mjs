// Fixed taxonomy only. Raw system text is never returned, stored or logged.
export function classifySystemError(value) {
  const text = typeof value === "string" ? value : "";
  const syscalls =
    "execveat|execve|openat2|openat|clone3|clone|setuid|setgid|setgroups|close_range|prctl|seccomp|sendmsg|recvmsg|socket|fcntl|fstatfs|statfs|statx|fstat|readlinkat|mount|pivot_root";
  // Match an explicit syscall/error form, not a word in a path/description.
  const knownSyscall =
    text
      .match(new RegExp(`(?:syscall[ :]+|SYS_)(${syscalls})\\b`, "i"))?.[1]
      .toLowerCase() ??
    text
      .match(
        new RegExp(
          `(?:^|[ :])(${syscalls}): (?:operation not permitted|permission denied|function not implemented|bad file descriptor|invalid argument)`,
          "i",
        ),
      )?.[1]
      .toLowerCase() ??
    null;
  const errno = /operation not permitted|\bEPERM\b/i.test(text)
    ? "EPERM"
    : /permission denied|\bEACCES\b/i.test(text)
      ? "EACCES"
      : /bad file descriptor|\bEBADF\b/i.test(text)
        ? "EBADF"
        : /function not implemented|\bENOSYS\b/i.test(text)
          ? "ENOSYS"
          : /too many open files|\bEMFILE\b/i.test(text)
            ? "EMFILE"
            : /no such file or directory|\bENOENT\b/i.test(text)
              ? "ENOENT"
              : /read-only file system|\bEROFS\b/i.test(text)
                ? "EROFS"
                : /invalid argument|\bEINVAL\b/i.test(text)
                  ? "EINVAL"
                  : null;
  const fifoOperation = /re-?open(?:ing)? exec fifo|reopen exec fifo/i.test(
    text,
  )
    ? "reopen"
    : /clos(?:e|ing) exec fifo/i.test(text)
      ? "close"
      : /open(?:ing)? exec fifo/i.test(text)
        ? "open"
        : /writ(?:e|ing) exec fifo/i.test(text)
          ? "write"
          : /wait(?:ing)?.{0,40}exec fifo/i.test(text)
            ? "wait"
            : /exec fifo/i.test(text)
              ? "unspecified"
              : null;
  const reference = /\/proc\/thread-self\/fd\//.test(text)
    ? "proc-thread-self-fd"
    : /\/proc\/self\/fd\//.test(text)
      ? "proc-self-fd"
      : /proc.*mount|mount namespace/i.test(text)
        ? "mount-namespace-description"
        : /exec fifo/i.test(text)
          ? "exec-fifo"
          : null;
  const rules = [
    [
      "control-template-invalid",
      /can't evaluate field|template parsing error/i,
    ],
    ["oci-fifo-failed", /exec fifo/i],
    [
      "oci-seccomp-install-failed",
      /unable to init seccomp|error loading seccomp|error setting seccomp|seccomp.*(?:invalid|permission|unsupported)/i,
    ],
    ["oci-thread-create-failed", /newosproc|failed to create new OS thread/i],
    ["oci-exec-failed", /execveat|execve|unable to execute|exec user process/i],
    [
      "oci-identity-failed",
      /setgroups|setuid|setgid|unable to set (?:uid|gid|groups)/i,
    ],
    [
      "thread-create-failed",
      /uv_thread_create|pthread_create|ThreadPoolTaskRunner/i,
    ],
    ["permission-denied", /EACCES|permission denied/i],
    ["operation-not-permitted", /EPERM|operation not permitted/i],
    [
      "module-unavailable",
      /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|cannot find module/i,
    ],
    ["runtime-abort", /assertion|aborted/i],
    [
      "oci-init-failed",
      /error during container init|OCI runtime create failed|runc create failed/i,
    ],
  ];
  return {
    category: text.length
      ? (rules.find(([, pattern]) => pattern.test(text))?.[0] ?? "unclassified")
      : "empty",
    knownSyscall,
    errno,
    fifoOperation,
    reference,
  };
}
