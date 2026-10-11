// An owned ChildProcess handle, not ESRCH/exit, supplies the stdio close fact.
// Each wait has one absolute monotonic budget; late close never changes its result.
export function watchOwnedClose(child) {
  let closedAt = null;
  const waiters = new Set();
  child.once("close", () => {
    closedAt = performance.now();
    for (const notify of [...waiters]) notify();
  });
  return {
    waitUntil(deadline) {
      return new Promise((ok) => {
        let done = false;
        let timer;
        const finish = () => {
          if (done) return;
          const now = performance.now();
          if (closedAt === null && now < deadline) return;
          done = true;
          clearTimeout(timer);
          waiters.delete(finish);
          ok(
            Object.freeze({
              closed:
                closedAt !== null && closedAt <= deadline && now <= deadline,
              stopped:
                closedAt !== null && closedAt <= deadline && now <= deadline
                  ? "confirmed"
                  : "unknown",
            }),
          );
        };
        waiters.add(finish);
        timer = setTimeout(finish, Math.max(0, deadline - performance.now()));
        finish();
      });
    },
    releaseHandles() {
      child.unref();
      child.stdout?.unref?.();
      child.stderr?.unref?.();
    },
  };
}
