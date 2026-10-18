import type {
  DisplayFontDescriptorV1,
  DisplayPosterExportBodyV1,
  DisplayResourceTransport,
} from "@/lib/assessment-contract/display-v1";

/**
 * The host supplies a verified stored report body and its exact registered font.
 * This display function grants no access, persistence or completion authority.
 */
export type ExportConsumerPosterV1 = (
  display: DisplayPosterExportBodyV1,
  transport: DisplayResourceTransport,
  font: DisplayFontDescriptorV1,
  signal: AbortSignal,
  current: () => boolean,
) => Promise<Blob>;
