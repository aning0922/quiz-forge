// Offline harness reporting only; source of capability authority is the atomic seal.
import type { Writable } from "node:stream";
export function emitFinalReport(
  stream: Writable,
  json: string,
  capabilityCommitted: boolean,
): Promise<{ reported: boolean; capabilityCommitted: boolean }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const failed = () => {
      if (settled) return;
      settled = true;
      if (capabilityCommitted)
        resolve({ reported: false, capabilityCommitted: true });
      else reject(new Error("REPORT_UNAVAILABLE"));
    };
    stream.once("error", failed);
    try {
      stream.write(json + "\n", (error) => {
        if (error) failed();
        else {
          if (settled) return;
          settled = true;
          stream.removeListener("error", failed);
          resolve({ reported: true, capabilityCommitted });
        }
      });
    } catch {
      failed();
    }
  });
}
