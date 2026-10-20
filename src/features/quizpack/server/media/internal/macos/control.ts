import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  opendirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { performance } from "node:perf_hooks";
import { dirname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { MEDIA_LIMITS } from "../../contracts";
const schema = z.strictObject({
  schema: z.literal("mac-media-active.v1"),
  runId: z.string().uuid(),
  profileId: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(["prepared", "issued", "spawned", "unknown"]),
  pid: z.number().int().positive().nullable(),
  workerStart: z
    .strictObject({
      sec: z.number().int().nonnegative(),
      usec: z.number().int().nonnegative(),
    })
    .nullable(),
  ownerPid: z.number().int().positive(),
  createdAt: z.string().datetime(),
});
type RecordValue = z.infer<typeof schema>;
import { MacControlError as ControlError } from "./control-errors";
export { ControlError };
function privateObject(path: string, directory: boolean) {
  const s = lstatSync(path);
  if (
    s.isSymbolicLink() ||
    (directory ? !s.isDirectory() : !s.isFile()) ||
    s.uid !== process.getuid?.() ||
    (s.mode & 0o777) !== (directory ? 0o700 : 0o600) ||
    (!directory && s.nlink !== 1)
  )
    throw new ControlError("ISOLATION_UNAVAILABLE");
  return s;
}
export function ensurePrivateDirectory(path: string, checkoutRoot: string) {
  const root = resolve(checkoutRoot);
  const target = resolve(path);
  // This is a private runtime containment check, not a build asset dependency.
  if (
    !target.startsWith(join(/* turbopackIgnore: true */ root, ".cache") + sep)
  )
    throw new ControlError("ISOLATION_UNAVAILABLE");
  const chain: string[] = [];
  for (let p = target; ; p = dirname(p)) {
    chain.push(p);
    if (p === root) break;
    if (p === dirname(p)) throw new ControlError("ISOLATION_UNAVAILABLE");
  }
  for (const p of chain.reverse()) {
    try {
      const s = lstatSync(p);
      if (
        s.isSymbolicLink() ||
        !s.isDirectory() ||
        s.uid !== process.getuid?.()
      )
        throw new ControlError("ISOLATION_UNAVAILABLE");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      mkdirSync(p, { mode: 0o700 });
    }
    if (p.includes("/.cache/")) privateObject(p, true);
  }
}
/** Trusted binding supplies the fixed root/control roles; business callers never see this constructor. */
export function createMacControl(location: {
  checkoutRoot: string;
  controlRoot: string;
}) {
  const CONTROL_ROOT = resolve(location.controlRoot);
  const active = join(CONTROL_ROOT, "active.json"),
    next = join(CONTROL_ROOT, "active.next"),
    guard = join(CONTROL_ROOT, "guard");
  function readBounded(): RecordValue {
    const original = privateObject(active, false);
    const fd = openSync(
      active,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const st = fstatSync(fd);
      if (
        st.ino !== original.ino ||
        st.dev !== original.dev ||
        st.uid !== process.getuid?.() ||
        st.nlink !== 1 ||
        (st.mode & 0o777) !== 0o600 ||
        st.size > MEDIA_LIMITS.controlBytes
      )
        throw new ControlError("ISOLATION_UNAVAILABLE");
      const buf = Buffer.alloc(MEDIA_LIMITS.controlBytes + 1);
      let total = 0;
      for (;;) {
        const n = readSync(fd, buf, total, buf.length - total, null);
        if (!n) break;
        total += n;
        if (total > MEDIA_LIMITS.controlBytes)
          throw new ControlError("ISOLATION_UNAVAILABLE");
      }
      const after = fstatSync(fd);
      if (
        after.size !== st.size ||
        after.mtimeMs !== st.mtimeMs ||
        total !== st.size
      )
        throw new ControlError("ISOLATION_UNAVAILABLE");
      const parsed = schema.safeParse(
        JSON.parse(buf.subarray(0, total).toString("utf8")),
      );
      if (!parsed.success) throw new ControlError("ISOLATION_UNAVAILABLE");
      return parsed.data;
    } finally {
      closeSync(fd);
    }
  }
  function createRecord(path: string, value: RecordValue) {
    const bytes = Buffer.from(JSON.stringify(value));
    if (bytes.length > MEDIA_LIMITS.controlBytes)
      throw new ControlError("ISOLATION_UNAVAILABLE");
    const fd = openSync(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      let written = 0;
      while (written < bytes.length) {
        const n = writeSync(fd, bytes, written, bytes.length - written);
        if (n <= 0) throw new ControlError("ISOLATION_UNAVAILABLE");
        written += n;
      }
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  function syncDirectory() {
    const fd = openSync(
      CONTROL_ROOT,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  /** No startup recovery: any leftover identity/guard, including malformed records,
   * blocks new runs. A restarted process never guesses or kills a persisted PID. */
  function acquireControl(runId: string, profileId: string) {
    try {
      ensurePrivateDirectory(CONTROL_ROOT, location.checkoutRoot);
      const entries: string[] = [];
      const dir = opendirSync(CONTROL_ROOT);
      try {
        for (;;) {
          const e = dir.readSync();
          if (!e) break;
          entries.push(e.name);
          if (entries.length > 3)
            throw new ControlError("ISOLATION_UNAVAILABLE");
        }
      } finally {
        dir.closeSync();
      }
      if (
        entries.length > 3 ||
        entries.some(
          (e) => !["active.json", "active.next", "guard"].includes(e),
        )
      )
        throw new ControlError("ISOLATION_UNAVAILABLE");
      if (entries.includes("active.json")) {
        readBounded();
        throw new ControlError("BUSY");
      }
      if (entries.length) throw new ControlError("BUSY");
      try {
        mkdirSync(guard, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new ControlError("BUSY");
        throw error;
      }
      const guardStat = privateObject(guard, true);
      let record: RecordValue = {
        schema: "mac-media-active.v1",
        runId,
        profileId,
        phase: "prepared",
        pid: null,
        workerStart: null,
        ownerPid: process.pid,
        createdAt: new Date().toISOString(),
      };
      createRecord(active, record);
      syncDirectory();
      function verify() {
        const gs = privateObject(guard, true);
        if (gs.ino !== guardStat.ino || gs.dev !== guardStat.dev)
          throw new ControlError("ISOLATION_UNAVAILABLE");
        const found = readBounded();
        if (JSON.stringify(found) !== JSON.stringify(record))
          throw new ControlError("ISOLATION_UNAVAILABLE");
      }
      return {
        update(
          phase: RecordValue["phase"],
          pid: number | null = record.pid,
          workerStart: RecordValue["workerStart"] = record.workerStart,
        ) {
          verify();
          const changed = { ...record, phase, pid, workerStart };
          createRecord(next, changed);
          verify();
          renameSync(next, active);
          syncDirectory();
          record = changed;
        },
        finish(deadlineMonotonicMs = Infinity) {
          const checkpoint = () => {
            if (performance.now() >= deadlineMonotonicMs)
              throw new ControlError("ISOLATION_UNAVAILABLE");
          };
          checkpoint();
          verify();
          checkpoint();
          const d = opendirSync(CONTROL_ROOT);
          const entries: string[] = [];
          try {
            for (;;) {
              const e = d.readSync();
              if (!e) break;
              entries.push(e.name);
              if (entries.length > 2)
                throw new ControlError("ISOLATION_UNAVAILABLE");
            }
          } finally {
            d.closeSync();
          }
          if (entries.sort().join() !== "active.json,guard")
            throw new ControlError("ISOLATION_UNAVAILABLE");
          checkpoint();
          unlinkSync(active);
          checkpoint();
          syncDirectory();
          checkpoint();
          const gs = privateObject(guard, true);
          if (gs.ino !== guardStat.ino || gs.dev !== guardStat.dev)
            throw new ControlError("ISOLATION_UNAVAILABLE");
          checkpoint();
          rmdirSync(guard);
          checkpoint();
          syncDirectory();
          checkpoint();
        },
      };
    } catch (error) {
      if (error instanceof ControlError) throw error;
      throw new ControlError("ISOLATION_UNAVAILABLE");
    }
  }

  /** Fixed private read for this synthetic harness; never exposes browser/task authority. */
  function readControlForHarness() {
    return readBounded();
  }

  return { acquireControl, readControlForHarness };
}
