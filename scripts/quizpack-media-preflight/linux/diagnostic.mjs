// Fixed taxonomy only. Raw system text is never returned, stored or logged.
export function classifySystemError(value) {
  const text = typeof value === "string" ? value : "";
  const knownSyscall =
    text
      .match(
        /\b(execveat|execve|openat2|openat|clone3|clone|setuid|setgid|setgroups|close_range|prctl|seccomp|sendmsg|recvmsg|socket|fcntl|fstat|readlinkat|mount|pivot_root)\b/i,
      )?.[1]
      .toLowerCase() ?? null;
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
  };
}
