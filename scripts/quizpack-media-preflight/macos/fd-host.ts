// Synthetic host with an intentionally inherited read-only FD300.
// Checks the SAME fixed launcher, not a substitute worker or FD mask.
import { fstatSync, readSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { runHarnessCase } from "./launcher";
import { parseProbeOutput } from "../shared/probe-protocol";
try {
  const st = fstatSync(300),
    b = Buffer.alloc(1);
  if (
    !st.isFile() ||
    st.uid !== process.getuid?.() ||
    (st.mode & 0o777) !== 0o600 ||
    readSync(300, b, 0, 1, 0) !== 1 ||
    b[0] !== 113
  )
    throw new Error("SYNTHETIC_FD_MISSING");
  const r = await runHarnessCase(
    { kind: "fd" },
    {
      signal: new AbortController().signal,
      deadlineMonotonicMs: performance.now() + 5000,
    },
  );
  const v = parseProbeOutput(r.output);
  process.stdout.write(
    JSON.stringify({
      schema: "mac-fd-host.v1",
      sourceFD300Present: true,
      stopped: r.stopped,
      workerScanComplete: v?.mode === "fd" && v.scanComplete,
      workerNoExtraFD: v?.mode === "fd" && v.noInheritedFileOrSocket,
    }),
  );
} catch {
  process.stdout.write('{"schema":"mac-fd-host.v1","code":"HARNESS_FAILED"}');
  process.exitCode = 1;
}
