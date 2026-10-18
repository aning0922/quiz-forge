import type { DisplayFontDescriptorV1 } from "@/lib/assessment-contract/display-v1";
import { exportConsumerPosterV1 } from "@/features/report/consumer-v1/export";
import { bindConsumerComponentsV1 } from "./registry";
/** Root's exact resolver supplies mapping/font from the registered descriptor; no default identity. */
export function bindConsumerRendererClientV1(
  mapping: unknown,
  fontInput: DisplayFontDescriptorV1,
) {
  const components = bindConsumerComponentsV1(mapping);
  if (!components) return null;
  const font = Object.freeze({ ...fontInput });
  return Object.freeze({
    components,
    exportPoster: (
      display: Parameters<typeof exportConsumerPosterV1>[0],
      transport: Parameters<typeof exportConsumerPosterV1>[1],
      signal: AbortSignal,
      current: () => boolean,
    ) => exportConsumerPosterV1(display, transport, font, signal, current),
  });
}
