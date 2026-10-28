import { readVerifiedBytes } from "@/lib/browser/display-assets";
import {
  withDisplayDeadline,
  checkpoint,
  awaitDisplayTask,
} from "@/lib/browser/display-task";
import type { ConsumerResourceLeaseV2 } from "../consumer-v2/resource-port";
import type { QIANZAI_RUNTIME_INPUTS } from "./runtime-inputs";

/** Fixed public font bytes, pinned by the compiled descriptor; never a pack/request URL. */
export async function loadQianzaiFont(
  font: NonNullable<typeof QIANZAI_RUNTIME_INPUTS.font>,
  lease: ConsumerResourceLeaseV2,
) {
  if (!/^\/assets\/fonts\/[a-zA-Z0-9_/-]+\.woff2$/.test(font.file))
    throw Error("QIANZAI_FONT_UNAVAILABLE");
  let cleanup: (() => void) | undefined;
  return withDisplayDeadline(lease.signal, async (signal, deadline) => {
    if (!lease.current()) throw Error("QIANZAI_AUTHORITY_LOST");
    const response = await fetch(font.file, {
      signal,
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      cache: "no-store",
    });
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => undefined);
      throw Error("QIANZAI_FONT_UNAVAILABLE");
    }
    const bytes = await readVerifiedBytes(
      response,
      font.bytes,
      font.fileSha256,
      signal,
      deadline,
    );
    const face = new FontFace(font.family, bytes, {
      weight: String(font.weight),
      style: "normal",
    });
    await awaitDisplayTask(face.load(), signal);
    checkpoint(signal, deadline);
    if (!lease.current()) throw Error("QIANZAI_AUTHORITY_LOST");
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      document.fonts.delete(face);
      lease.signal.removeEventListener("abort", release);
    };
    cleanup = release;
    document.fonts.add(face);
    lease.signal.addEventListener("abort", release, { once: true });
    if (!lease.current() || lease.signal.aborted) {
      release();
      throw Error("QIANZAI_AUTHORITY_LOST");
    }
    return { release };
  }).catch((error: unknown) => {
    cleanup?.();
    throw error;
  });
}
