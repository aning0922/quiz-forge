import "server-only";
import { createHash } from "node:crypto";
import { canonicalP1Json } from "../../v1/canonical";
import { quizPackContentSchema, type QuizPackContent } from "../../v1/content";
import {
  quizPackManifestSchema,
  type QuizPackManifest,
} from "../../v1/manifest";
import {
  sealCandidateResultEvidence,
  type CandidateResultEvidence,
} from "./contracts";
import { EVIDENCE_LIMITS, freezeJson } from "./report";
import { assertPersistenceUnicode, EvidenceError } from "./unicode";

export type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
type Resource = {
  declaration: DeepReadonly<QuizPackContent["resources"][number]>;
  canonicalDeclarationText: string;
  declarationSha256: string;
  blobSha256: string;
  bytes: number;
};
export type CandidateFacts = {
  schemaVersion: "quizpack-private-candidate.v1";
  archiveSha256: string;
  productId: string;
  packId: string;
  packVersion: string;
  manifest: DeepReadonly<QuizPackManifest>;
  content: DeepReadonly<QuizPackContent>;
  canonicalManifestText: string;
  canonicalManifestSha256: string;
  canonicalContentText: string;
  canonicalContentSha256: string;
  resources: readonly Resource[];
  assetSetSha256: string;
  candidateSha256: string;
};
type State = {
  facts: DeepReadonly<CandidateFacts>;
  resources: readonly Buffer[];
};
const states = new WeakMap<PrivateArchiveCandidate, State>();
const issuance = Object.freeze({});
const hash = (input: Uint8Array | string) =>
  createHash("sha256").update(input).digest("hex");

/** JSON and structural parsing never confer ownership of private resource bytes. */
export class PrivateArchiveCandidate {
  constructor(token: object) {
    if (token !== issuance) throw new EvidenceError("INVALID_CANDIDATE");
    Object.freeze(this);
  }
  get facts(): DeepReadonly<CandidateFacts> {
    const state = states.get(this);
    if (!state) throw new EvidenceError("INVALID_CANDIDATE");
    return state.facts;
  }
  toJSON(): never {
    throw new EvidenceError("INVALID_CANDIDATE");
  }
}

/** Internal issuance follows fully bounded accepted evidence; not a JSON import API. */
export function issuePrivateCandidate(
  accepted: Extract<CandidateResultEvidence, { outcome: "accepted" }>,
  manifestInput: QuizPackManifest,
  contentInput: QuizPackContent,
  files: ReadonlyMap<string, Uint8Array>,
): PrivateArchiveCandidate {
  const sealed = sealCandidateResultEvidence(accepted);
  if (sealed.outcome !== "accepted")
    throw new EvidenceError("INVALID_CANDIDATE");
  if (
    accepted.evidence.input.status !== "snapshotted" ||
    accepted.evidence.identity.status !== "bound" ||
    accepted.evidence.report.status !== "sealed"
  )
    throw new EvidenceError("INVALID_CANDIDATE");
  const canonicalManifestText = canonicalP1Json(manifestInput, "manifest");
  const canonicalContentText = canonicalP1Json(contentInput, "content");
  const manifest = quizPackManifestSchema.parse(
    JSON.parse(canonicalManifestText),
  );
  const content = quizPackContentSchema.parse(JSON.parse(canonicalContentText));
  assertPersistenceUnicode(manifest);
  assertPersistenceUnicode(content);
  const manifestBytes = files.get("manifest.json");
  const contentBytes = files.get("content.json");
  if (
    !manifestBytes ||
    !contentBytes ||
    hash(manifestBytes) !== accepted.evidence.report.value.manifestSha256 ||
    hash(contentBytes) !== accepted.evidence.report.value.contentSha256 ||
    accepted.evidence.media.length !== content.resources.length
  )
    throw new EvidenceError("INVALID_CANDIDATE");
  for (const [index, declaration] of content.resources.entries()) {
    const fact = accepted.evidence.media.find(
      (item) => item.resourceIndex === index,
    )?.result;
    if (
      !fact ||
      fact.outcome !== "decoded" ||
      fact.facts.mediaType !== declaration.mediaType ||
      fact.facts.width !== declaration.width ||
      fact.facts.height !== declaration.height
    )
      throw new EvidenceError("INVALID_CANDIDATE");
  }
  const resources: Buffer[] = [];
  const declarations = [...content.resources].sort((a, b) =>
    a.id < b.id
      ? -1
      : a.id > b.id
        ? 1
        : a.version < b.version
          ? -1
          : a.version > b.version
            ? 1
            : 0,
  );
  const resourceFacts = declarations.map((declaration): Resource => {
    const bytes = files.get(declaration.path);
    if (!bytes) throw new EvidenceError("INVALID_CANDIDATE");
    const snapshot = Buffer.from(bytes);
    if (
      snapshot.byteLength !== declaration.bytes ||
      hash(snapshot) !== declaration.sha256
    )
      throw new EvidenceError("INVALID_CANDIDATE");
    resources.push(snapshot);
    const canonicalDeclarationText = canonicalP1Json(declaration);
    if (
      Buffer.byteLength(canonicalDeclarationText, "utf8") >
      EVIDENCE_LIMITS.resourceDeclarationBytes
    )
      throw new EvidenceError("INVALID_CANDIDATE");
    return {
      declaration,
      canonicalDeclarationText,
      declarationSha256: hash(canonicalDeclarationText),
      blobSha256: hash(snapshot),
      bytes: snapshot.length,
    };
  });
  const productId = accepted.evidence.input.targetProductId;
  if (
    manifest.productId !== productId ||
    content.product.productId !== productId ||
    content.kind !== "synthetic"
  )
    throw new EvidenceError("INVALID_CANDIDATE");
  const assetSetSha256 = hash(
    canonicalP1Json({
      schemaVersion: "quizpack-candidate-asset-set.v1",
      productId,
      resources: resourceFacts.map((resource) => ({
        resourceId: resource.declaration.id,
        resourceVersion: resource.declaration.version,
        productId: resource.declaration.productId,
        blobSha256: resource.blobSha256,
        declarationSha256: resource.declarationSha256,
      })),
    }),
  );
  const canonicalManifestSha256 = hash(canonicalManifestText);
  const canonicalContentSha256 = hash(canonicalContentText);
  const archiveSha256 = accepted.evidence.input.archiveSha256;
  const candidateSha256 = hash(
    canonicalP1Json({
      schemaVersion: "quizpack-candidate-hash.v1",
      archiveSha256,
      canonicalManifestSha256,
      canonicalContentSha256,
      assetSetSha256,
      identitySha256: accepted.evidence.identity.value.identitySha256,
    }),
  );
  const handle = new PrivateArchiveCandidate(issuance);
  states.set(handle, {
    resources,
    facts: freezeJson({
      schemaVersion: "quizpack-private-candidate.v1",
      archiveSha256,
      productId,
      packId: manifest.packId,
      packVersion: manifest.packVersion,
      manifest,
      content,
      canonicalManifestText,
      canonicalManifestSha256,
      canonicalContentText,
      canonicalContentSha256,
      resources: resourceFacts,
      assetSetSha256,
      candidateSha256,
    }),
  });
  return handle;
}

/** Trusted service access returns a fresh copy; hashes/ownership remain unchanged. */
export function copyCandidateResourceBytes(
  candidate: PrivateArchiveCandidate,
  index: number,
): Uint8Array {
  const state = states.get(candidate);
  if (
    !state ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= state.resources.length
  )
    throw new EvidenceError("INVALID_CANDIDATE");
  return Buffer.from(state.resources[index]!);
}

export type CandidateResult =
  | (Extract<CandidateResultEvidence, { outcome: "accepted" }> & {
      readonly candidate: PrivateArchiveCandidate;
    })
  | Extract<CandidateResultEvidence, { outcome: "rejected" | "interrupted" }>;
