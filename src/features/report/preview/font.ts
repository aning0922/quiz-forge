import type { DisplayFontDescriptorV1 } from "@/lib/assessment-contract/display-v1";
import {
  DisplayClientError,
  checkpoint,
  withDisplayDeadline,
  awaitDisplayTask,
} from "@/lib/browser/display-task";
import { readVerifiedBytes } from "@/lib/browser/display-assets";
/** No cross-request cached success: each export verifies the controlled file and coverage bytes. */
export async function withPreviewFont<T>(
  fontDescriptor: DisplayFontDescriptorV1,
  texts: readonly string[],
  signal: AbortSignal,
  render: (
    family: string,
    active: AbortSignal,
    deadlineMonotonicMs: number,
  ) => Promise<T>,
): Promise<T> {
  let face: FontFace | undefined,
    fontReady = false;
  try {
    return await withDisplayDeadline(signal, async (active, deadline) => {
      const load = async (
        path: string,
        bytes: number,
        hash: string,
        exact = true,
      ) => {
        const response = await fetch(path, {
          signal: active,
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
        });
        if (response.status !== 200)
          throw new DisplayClientError("FONT_UNAVAILABLE");
        try {
          return await readVerifiedBytes(
            response,
            bytes,
            hash,
            active,
            deadline,
            exact,
          );
        } catch (error) {
          if (
            error instanceof DisplayClientError &&
            ["PREVIEW_CANCELLED", "PREVIEW_TIMEOUT"].includes(error.code)
          )
            throw error;
          throw new DisplayClientError("FONT_UNAVAILABLE");
        }
      };
      const font = await load(
        fontDescriptor.file,
        fontDescriptor.bytes,
        fontDescriptor.fileSha256,
      );
      const coverage = await load(
        fontDescriptor.coverage,
        65536,
        fontDescriptor.coverageSha256,
        false,
      );
      const chars = new Set(
        new TextDecoder("utf-8", { fatal: true }).decode(coverage),
      );
      if (
        texts.some((text) =>
          [...text].some((char) => !/[\r\n]/.test(char) && !chars.has(char)),
        )
      )
        throw new DisplayClientError("FONT_COVERAGE");
      checkpoint(active, deadline);
      // A unique family prevents a previously registered/system face from satisfying this load.
      const family = `QuizForgePreview${crypto.randomUUID().replaceAll("-", "")}`;
      face = new FontFace(family, font, {
        weight: String(fontDescriptor.weight),
        style: "normal",
      });
      await awaitDisplayTask(face.load(), active);
      checkpoint(active, deadline);
      document.fonts.add(face);
      if (
        face.status !== "loaded" ||
        !document.fonts.check(`600 32px "${family}"`, texts.join(""))
      )
        throw new DisplayClientError("FONT_UNAVAILABLE");
      // The caller owns a separate generation gate during canvas encoding as well.
      fontReady = true;
      return await render(family, active, deadline);
    });
  } catch (error) {
    if (error instanceof DisplayClientError) throw error;
    throw new DisplayClientError(
      fontReady ? "PNG_UNAVAILABLE" : "FONT_UNAVAILABLE",
    );
  } finally {
    if (face) document.fonts.delete(face);
  }
}
