import type { DisplayFontDescriptorV1 } from "@/lib/assessment-contract/display-v1";
import { DisplayClientError } from "@/lib/browser/display-task";
import type {
  DisplayAssetV2 as DisplayAssetV1,
  DisplayResourceTransportV2 as DisplayResourceTransport,
} from "@/lib/assessment-contract/display-v2";
import type { ComposedReportBodyV1 } from "@/lib/assessment-contract/composed-report-v1";
import type { QianzaiResultPresentation } from "./result-presentation";

export type QianzaiExportKind = "poster" | "full-report";
export type QianzaiExportErrorCode =
  | "NOT_COMPLETED"
  | "CAPABILITY_UNAVAILABLE"
  | "AUTHORITY_LOST"
  | "ARTWORK_UNAVAILABLE"
  | "FONT_UNAVAILABLE"
  | "FONT_COVERAGE"
  | "CONTENT_LIMIT"
  | "RESOURCE_UNAVAILABLE"
  | "PNG_UNAVAILABLE"
  | "CANCELLED"
  | "BUSY";
export class QianzaiExportError extends DisplayClientError {
  constructor(readonly code: QianzaiExportErrorCode) {
    super(code);
  }
}
export type QianzaiExportArtifact = Readonly<{
  kind: QianzaiExportKind;
  previewUrl: `blob:${string}`;
  width: number;
  height: number;
  bytes: number;
  fileName: string;
}>;
export type QianzaiExportState =
  | { phase: "closed" }
  | { phase: "idle" }
  | { phase: "rendering"; kind: QianzaiExportKind }
  | { phase: "ready"; artifact: QianzaiExportArtifact }
  | { phase: "error"; kind: QianzaiExportKind; code: QianzaiExportErrorCode };
export type QianzaiExportAvailability = Readonly<{
  allowed: boolean;
  reason: QianzaiExportErrorCode | null;
}>;
export type QianzaiShareOutcome =
  "shared" | "cancelled" | "download-required" | "unavailable" | "failed";
export type QianzaiExportContextValue = Readonly<{
  availability: Readonly<Record<QianzaiExportKind, QianzaiExportAvailability>>;
  state: QianzaiExportState;
  /** Same report-owner cache; dismissing the dialog does not release it. */
  getCachedArtifact(kind: QianzaiExportKind): QianzaiExportArtifact | null;
  getResultPresentation(): QianzaiResultPresentation | null;
  getFailure(kind: QianzaiExportKind): QianzaiExportErrorCode | null;
  prepare(includeFullReport?: boolean): Promise<void>;
  open(): void;
  generate(kind: QianzaiExportKind): Promise<void>;
  close(): void;
  download(): boolean;
  share(): Promise<QianzaiShareOutcome>;
}>;
/** Created by the authorized runtime adapter. No paths, keys, or caller-supplied scores. */
export type QianzaiExportScope = Readonly<{
  body: ComposedReportBodyV1;
  presentation?: QianzaiResultPresentation;
  portrait: DisplayAssetV1;
  nameArt: DisplayAssetV1;
  paper: DisplayAssetV1 | null;
  font: DisplayFontDescriptorV1;
  transport: DisplayResourceTransport;
  current(): boolean;
}>;
export const QIANZAI_EXPORT_LIMITS = Object.freeze({
  posterWidth: 941,
  posterHeight: 1672,
  reportWidth: 724,
  maxHeight: 16384,
  maxCanvasPixels: 12_000_000,
  maxImagePixels: 8_000_000,
  maxTextCodepoints: 80_000,
  maxPngBytes: 16_777_216,
});
