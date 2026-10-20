/** Shared P1 boundary. Technical evidence never grants import or publication. */
export interface PackIssue {
  code: string;
  path: (string | number)[];
  message: string;
}

export type Result<T> =
  { ok: true; value: T } | { ok: false; issues: PackIssue[] };

export interface TrustedCompatibilityPolicy {
  contentSchemaVersions: readonly string[];
  engines: readonly { id: string; version: string }[];
  components: readonly {
    id: string;
    version: string;
    propsSchemaVersion: string;
  }[];
}

export type CheckState = "passed" | "failed" | "not-run";
export interface QuizPackValidationReport {
  schemaVersion: "quizpack-validation.v1";
  archiveSha256?: string;
  manifestSha256?: string;
  contentSha256?: string;
  targetProductId: string;
  validatorVersion: string;
  policyId: string;
  compatibilityPolicyHash: string;
  effectiveLimitsHash: string;
  checks: Record<
    | "container"
    | "structure"
    | "references"
    | "integrity"
    | "media"
    | "compatibility",
    CheckState
  >;
  candidateValid: boolean;
  importable: false;
  publishable: false;
  issues: PackIssue[];
  issuesTruncated: boolean;
  unverified: string[];
}

export interface ValidationContext {
  targetProductId: string;
  compatibilityPolicy?: TrustedCompatibilityPolicy;
  signal?: AbortSignal;
  /** May only lower the fixed production limits. Invalid overrides fail closed. */
  limits?: Partial<import("./limits").PackLimits>;
}

export interface ImageDeclaration {
  path: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  bytes: number;
  sha256: string;
  width: number;
  height: number;
}

export interface ImageFacts {
  mediaType: ImageDeclaration["mediaType"];
  width: number;
  height: number;
  frames: 1;
  mediaDecoded: true;
}

export interface ImageInspectionContext {
  signal: AbortSignal;
  limits: Readonly<
    Pick<
      import("./limits").PackLimits,
      "resourceBytes" | "imageDimension" | "imagePixels" | "imageMs"
    >
  >;
}

export interface BuildInput {
  packId: string;
  packVersion: string;
  content: unknown;
  assets: readonly { path: string; bytes: Uint8Array }[];
}

export interface BuildOutput {
  archive: Uint8Array;
  report: QuizPackValidationReport;
}
