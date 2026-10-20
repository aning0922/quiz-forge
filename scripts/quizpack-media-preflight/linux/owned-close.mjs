// An owned ChildProcess handle, not ESRCH/exit, supplies the stdio close fact.
// Each wait has one absolute monotonic budget; late close never changes its result.
export function watchOwnedClose(
  child,
  timing = {
    now: () => performance.now(),
    setTimer: setTimeout,
    clearTimer: clearTimeout,
  },
) {
  let closedAt = null;
  const waiters = new Set();
  child.once("close", () => {
    closedAt = timing.now();
    for (const notify of [...waiters]) notify();
  });
  return {
    waitUntil(deadline) {
      return new Promise((ok) => {
        let done = false;
        let timer;
        const finish = () => {
          if (done) return;
          const now = timing.now();
          if (closedAt === null && now < deadline) {
            timing.clearTimer(timer);
            timer = timing.setTimer(
              finish,
              Math.max(1, Math.ceil(deadline - now)),
            );
            return;
          }
          done = true;
          timing.clearTimer(timer);
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
        timer = timing.setTimer(
          finish,
          Math.max(0, Math.ceil(deadline - timing.now())),
        );
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
