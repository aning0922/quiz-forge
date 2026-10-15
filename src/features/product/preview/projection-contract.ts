import type {
  PreviewBinding,
  PreviewEntry,
  PreviewResult,
  PreviewReveal,
} from "./contracts";
declare const preparedPreview: unique symbol;
/** Issued only by the server projection's private WeakMap; never serialized to a client. */
export type PreparedPreview = Readonly<{ [preparedPreview]: true }>;
export type PreparedPreviewValue = Readonly<{
  entry: PreviewEntry;
  prepared: PreparedPreview;
}>;
export type PreparePreviewContent = (
  content: unknown,
  binding: PreviewBinding,
) => PreviewResult<PreparedPreviewValue>;
export type ScorePreview = (
  prepared: PreparedPreview,
  answers: unknown,
  requestId: unknown,
) => PreviewResult<PreviewReveal>;
/** Implement in features/theme/preview/projection.ts; service calls these exact server-only entrypoints. */
export interface PreviewProjection {
  preparePreviewContent: PreparePreviewContent;
  scorePreview: ScorePreview;
}
