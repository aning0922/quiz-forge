import type { ReportPolicy } from "@/features/report/contracts";
import type { ProductVisualBinding } from "@/features/theme/contracts";

export type QuizEngineKind = "dimensions" | "archetype" | "branching";

/** Compile-time D0 proposal; not the final JSON Schema or a validation guarantee. */
export interface QuizPackManifestDraft {
  formatVersion: "quizpack.v1-draft";
  packId: string;
  packVersion: string;
  productId: string;
  productVersion: string;
  logicVersion: string;
  engine: { kind: QuizEngineKind; version: string };
  compatibility: {
    runtimeVersionRange: string;
    contentSchemaVersion: string;
    requiredComponents: readonly { registryId: string; versionRange: string }[];
  };
  report: ReportPolicy;
  visual: ProductVisualBinding;
  files: readonly {
    path: string;
    sha256: string;
    bytes: number;
    mediaType: string;
  }[];
}
