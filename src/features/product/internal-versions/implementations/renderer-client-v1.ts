import { PREVIEW_COMPONENTS } from "@/features/theme/preview/components";
import { exportDisplayPoster } from "@/features/report/preview/export";
import type {
  DisplayFontDescriptorV1,
  DisplayPosterExportBodyV1,
  DisplayResourceTransport,
} from "@/lib/assessment-contract/display-v1";
/** The exact catalog resolver supplies this font descriptor; this adapter never consults a latest font. */
export function bindRendererClientV1(fontInput: DisplayFontDescriptorV1) {
  const font = Object.freeze({ ...fontInput });
  return Object.freeze({
    components: PREVIEW_COMPONENTS,
    exportPoster(
      value: DisplayPosterExportBodyV1,
      transport: DisplayResourceTransport,
      signal: AbortSignal,
      current: () => boolean,
    ) {
      return exportDisplayPoster(value, transport, font, signal, current);
    },
  });
}
