import { PREVIEW_FONT_ASSET } from "@/features/product/preview/descriptor";
import {
  PreviewClientError,
  checkpoint,
  withPreviewDeadline,
  awaitPreviewTask,
} from "@/features/studio/preview/client";
import { readVerifiedBytes } from "@/features/studio/preview/media";
/** No cross-request cached success: each export verifies the controlled file and coverage bytes. */
export async function withPreviewFont<T>(
  texts: readonly string[],
  signal: AbortSignal,
  render: (family: string, active: AbortSignal) => Promise<T>,
): Promise<T> {
  let face: FontFace | undefined,
    fontReady = false;
  try {
    return await withPreviewDeadline(signal, async (active, deadline) => {
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
          throw new PreviewClientError("FONT_UNAVAILABLE");
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
            error instanceof PreviewClientError &&
            ["PREVIEW_CANCELLED", "PREVIEW_TIMEOUT"].includes(error.code)
          )
            throw error;
          throw new PreviewClientError("FONT_UNAVAILABLE");
        }
      };
      const font = await load(
        PREVIEW_FONT_ASSET.file,
        PREVIEW_FONT_ASSET.bytes,
        PREVIEW_FONT_ASSET.fileSha256,
      );
      const coverage = await load(
        PREVIEW_FONT_ASSET.coverage,
        65536,
        PREVIEW_FONT_ASSET.coverageSha256,
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
        throw new PreviewClientError("FONT_COVERAGE");
      checkpoint(active, deadline);
      // A unique family prevents a previously registered/system face from satisfying this load.
      const family = `QuizForgePreview${crypto.randomUUID().replaceAll("-", "")}`;
      face = new FontFace(family, font, {
        weight: String(PREVIEW_FONT_ASSET.weight),
        style: "normal",
      });
      await awaitPreviewTask(face.load(), active);
      checkpoint(active, deadline);
      document.fonts.add(face);
      if (
        face.status !== "loaded" ||
        !document.fonts.check(`600 32px "${family}"`, texts.join(""))
      )
        throw new PreviewClientError("FONT_UNAVAILABLE");
      // The caller owns a separate generation gate during canvas encoding as well.
      fontReady = true;
      return await render(family, active);
    });
  } catch (error) {
    if (error instanceof PreviewClientError) throw error;
    throw new PreviewClientError(
      fontReady ? "PNG_UNAVAILABLE" : "FONT_UNAVAILABLE",
    );
  } finally {
    if (face) document.fonts.delete(face);
  }
}
