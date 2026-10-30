import "server-only";
import { readContentMetadata } from "../../content/current";
import { createHash } from "node:crypto";
import { types } from "node:util";
import { canonicalP1Json } from "../../v1/canonical";
import { parsePackJson } from "../../v1/io";
import { PACK_LIMITS } from "../../v1/limits";
import type { CurrentResourceV3 } from "../../content/v3";
import type { SupportedParsedPack } from "../../package/api";
import { parseSupportedPack } from "../../package/manifest";
import { checkArchiveIntegrity } from "../../v1/validate-core";
import { checkCurrentCompatibility as checkCompatibility } from "../../package/current-compatibility";
import { CURRENT_COMPATIBILITY_POLICY as SUPPORTED_COMPATIBILITY_POLICY } from "../../package/current-compatibility";
import {
  sealCandidateResultEvidence,
  type CandidateResultEvidence,
} from "./contracts";
import { EVIDENCE_LIMITS, freezeJson } from "./report";
import { assertPersistenceUnicode, EvidenceError } from "./unicode";
import { computeCandidateSha256 } from "./candidate-hash";

export type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
type Resource = {
  declaration: DeepReadonly<CurrentResourceV3>;
  canonicalDeclarationText: string;
  declarationSha256: string;
  blobSha256: string;
  bytes: number;
};
export type CandidateFacts = DeepReadonly<SupportedParsedPack> & {
  schemaVersion: "quizpack-private-candidate.v1";
  archiveSha256: string;
  productId: string;
  packId: string;
  packVersion: string;
  canonicalManifestText: string;
  canonicalManifestSha256: string;
  canonicalContentText: string;
  canonicalContentSha256: string;
  resources: readonly Resource[];
  assetSetText: string;
  assetSetSha256: string;
  candidateSha256: string;
};
type State = {
  facts: DeepReadonly<CandidateFacts>;
  resources: readonly Buffer[];
};
const states = new WeakMap<PrivateArchiveCandidate, State>();
const preparations = new WeakMap<DeepReadonly<CandidateFacts>, State>();
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
export function preparePrivateCandidate(
  accepted: Extract<CandidateResultEvidence, { outcome: "accepted" }>,
  files: ReadonlyMap<string, Uint8Array>,
): DeepReadonly<CandidateFacts> {
  const sealed = sealCandidateResultEvidence(accepted);
  if (sealed.outcome !== "accepted")
    throw new EvidenceError("INVALID_CANDIDATE");
  if (
    sealed.evidence.input.status !== "snapshotted" ||
    sealed.evidence.identity.status !== "bound" ||
    sealed.evidence.report.status !== "sealed"
  )
    throw new EvidenceError("INVALID_CANDIDATE");
  if (!(files instanceof Map) || types.isProxy(files))
    throw new EvidenceError("INVALID_CANDIDATE");
  const manifestSource = files.get("manifest.json");
  const contentSource = files.get("content.json");
  if (
    !manifestSource ||
    !contentSource ||
    manifestSource.byteLength > PACK_LIMITS.manifestBytes ||
    contentSource.byteLength > PACK_LIMITS.contentBytes
  )
    throw new EvidenceError("INVALID_CANDIDATE");
  const manifestBytes = Buffer.from(manifestSource);
  const contentBytes = Buffer.from(contentSource);
  if (
    !manifestBytes ||
    !contentBytes ||
    hash(manifestBytes) !== sealed.evidence.report.value.manifestSha256 ||
    hash(contentBytes) !== sealed.evidence.report.value.contentSha256
  )
    throw new EvidenceError("INVALID_CANDIDATE");
  // Sole source of declarations: the same bounded raw bytes already tied to
  // the sealed validation report. No independently supplied parsed objects are trusted.
  const parsed = parseSupportedPack(
    parsePackJson(manifestBytes, PACK_LIMITS.jsonDepth),
    parsePackJson(contentBytes, PACK_LIMITS.jsonDepth),
    { kind: "backend-matrix" },
  );
  if (!parsed.ok) throw new EvidenceError("INVALID_CANDIDATE");
  const pack = parsed.value;
  const { manifest, content } = pack;
  const metadata = readContentMetadata(content);
  if (
    sealed.evidence.identity.value.schemaVersion !==
      "quizpack-validation-identity.v3" &&
    content.schemaVersion === "quizpack-content.v3"
  )
    throw new EvidenceError("INVALID_CANDIDATE");
  // Legacy evidence is readable only for the original v1/synthetic matrix.
  if (
    sealed.evidence.identity.value.schemaVersion ===
      "quizpack-validation-identity.v1" &&
    (pack.contentSchemaVersion !== "quizpack-content.v1" ||
      metadata.kind !== "synthetic")
  )
    throw new EvidenceError("INVALID_CANDIDATE");
  const profile = SUPPORTED_COMPATIBILITY_POLICY.profiles.find(
    (item) => item.contentSchemaVersion === pack.contentSchemaVersion,
  )!;
  if (
    checkArchiveIntegrity(manifest, files).length ||
    checkCompatibility(manifest, {
      contentSchemaVersions: [profile.contentSchemaVersion],
      engines: SUPPORTED_COMPATIBILITY_POLICY.engines,
      components: Object.values(profile.states).map((id) => ({
        id,
        version: profile.componentVersion,
        propsSchemaVersion: profile.propsSchemaVersion,
      })),
    }).length
  )
    throw new EvidenceError("INVALID_CANDIDATE");
  const canonicalManifestText = canonicalP1Json(manifest, "manifest");
  const canonicalContentText = canonicalP1Json(content, "content");
  assertPersistenceUnicode(manifest);
  assertPersistenceUnicode(content);
  if (sealed.evidence.media.length !== metadata.resources.length)
    throw new EvidenceError("INVALID_CANDIDATE");
  for (const [index, declaration] of metadata.resources.entries()) {
    const fact = sealed.evidence.media.find(
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
  const declarations = [...metadata.resources].sort((a, b) =>
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
  const productId = sealed.evidence.input.targetProductId;
  if (manifest.productId !== productId || metadata.productId !== productId)
    throw new EvidenceError("INVALID_CANDIDATE");
  const assetSetText = canonicalP1Json({
    schemaVersion: "quizpack-candidate-asset-set.v1",
    productId,
    resources: resourceFacts.map((resource) => ({
      resourceId: resource.declaration.id,
      resourceVersion: resource.declaration.version,
      productId: resource.declaration.productId,
      blobSha256: resource.blobSha256,
      declarationSha256: resource.declarationSha256,
    })),
  });
  const assetSetSha256 = hash(assetSetText);
  const canonicalManifestSha256 = hash(canonicalManifestText);
  const canonicalContentSha256 = hash(canonicalContentText);
  const archiveSha256 = sealed.evidence.input.archiveSha256;
  const candidateSha256 = computeCandidateSha256({
    archiveSha256,
    canonicalManifestSha256,
    canonicalContentSha256,
    assetSetSha256,
    identitySha256: sealed.evidence.identity.value.identitySha256,
  });
  const facts = freezeJson({
    schemaVersion: "quizpack-private-candidate.v1" as const,
    archiveSha256,
    productId,
    packId: manifest.packId,
    packVersion: manifest.packVersion,
    ...pack,
    canonicalManifestText,
    canonicalManifestSha256,
    canonicalContentText,
    canonicalContentSha256,
    resources: resourceFacts,
    assetSetText,
    assetSetSha256,
    candidateSha256,
  });
  preparations.set(facts, { facts, resources });
  return facts;
}

/** Internal same-object issuance follows all comparison, IO and final checkpoint proofs. */
export function issuePreparedCandidate(
  facts: DeepReadonly<CandidateFacts>,
): PrivateArchiveCandidate {
  const state = preparations.get(facts);
  if (!state) throw new EvidenceError("INVALID_CANDIDATE");
  preparations.delete(facts);
  const handle = new PrivateArchiveCandidate(issuance);
  states.set(handle, state);
  return handle;
}
export function issuePrivateCandidate(
  accepted: Extract<CandidateResultEvidence, { outcome: "accepted" }>,
  files: ReadonlyMap<string, Uint8Array>,
): PrivateArchiveCandidate {
  return issuePreparedCandidate(preparePrivateCandidate(accepted, files));
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
