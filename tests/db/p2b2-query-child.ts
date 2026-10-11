/** Standalone Node rejection observation; no PG, credentials or raw exception output. */
import { StorageLock } from "../../src/features/quizpack/import/storage-lock";
async function main() {
  for (const kind of ["deadline", "abort"]) {
    const client = { end: async () => {} },
      connection = Object.assign(async () => [], { release: () => {} }),
      controller = new AbortController(),
      context = {
        signal: controller.signal,
        deadlineMonotonicMs: performance.now() + 1000,
      },
      lock = Reflect.construct(StorageLock, [
        client,
        connection,
        context,
      ]) as StorageLock;
    let unhandled = false,
      started = false,
      code = "SUCCESS";
    const observer = () => {
      unhandled = true;
    };
    process.on("unhandledRejection", observer);
    try {
      await lock.query(() => {
        started = true;
        if (kind === "deadline")
          context.deadlineMonotonicMs = performance.now() - 1;
        else controller.abort();
        return Promise.reject(new Error("FACTORY_REJECTION"));
      });
    } catch (e) {
      code = e instanceof Error ? e.message : "FAILED";
    }
    await new Promise<void>((r) => setImmediate(r));
    process.removeListener("unhandledRejection", observer);
    await lock.close();
    if (!started || code !== "RECEIVE_LOCK_LOST" || unhandled)
      throw new Error("QUERY_OBSERVATION_FAILED");
  }
  process.stdout.write("QUERY_OBSERVATION_OK\n");
}
main().catch(() => {
  process.stderr.write("QUERY_OBSERVATION_FAILED\n");
  process.exitCode = 1;
});
