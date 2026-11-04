import { privateTestUseSchema } from "../src/features/quizpack/content/private-test";
import { QIANZAI_KNOWN_TEN_EXPERIENCE_IDENTITY } from "../src/features/quizpack/content/private-test-known-ten-experience-identity";
/** Stage the one reviewed known-ten candidate in its normal managed test root.
 * This produces content/resources only; no import, DB/source admission or build. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { loadManagedInstance } from "../src/lib/db/management";
import { QIANZAI_KNOWN_TEN_FINAL_TEST_IDENTITY as originalIdentity } from "../src/features/quizpack/content/private-test-known-ten-final-identity";
import { QIANZAI_KNOWN_TEN_ROLES } from "../src/features/report/qianzai-tongxin/known-ten-catalog";
import { qianzaiKnownScoringDefinition } from "../src/features/report/qianzai-tongxin/known-ten-scoring";
import { canonicalP1Json } from "../src/features/quizpack/v1/canonical";
import { quizPackContentV3Schema } from "../src/features/quizpack/content/v3";
import { prepareContentV3 } from "../src/features/quizpack/content/v3-scoring-adapter";
import { verifyPreparedContentWitnessesV3 } from "../src/features/quizpack/content/v3-witnesses";
import { scoringDefinitionV2Schema } from "../src/lib/assessment-contract/scoring-v2";

const [
  sourceFile,
  intakeDirectory,
  coverageFile,
  templateFile,
  outputDirectory,
  identityFlag,
] = process.argv.slice(2);
assert(
  sourceFile &&
    intakeDirectory &&
    coverageFile &&
    templateFile &&
    outputDirectory,
);
assert(identityFlag === undefined || identityFlag === "--experience");
assert.equal(process.argv.length, identityFlag === undefined ? 7 : 8);
const identity =
  identityFlag === "--experience"
    ? QIANZAI_KNOWN_TEN_EXPERIENCE_IDENTITY
    : originalIdentity;
for (const file of [sourceFile, intakeDirectory, coverageFile, templateFile]) {
  assert(path.isAbsolute(file));
  assert.equal(await realpath(file), file);
}
const output = path.resolve(outputDirectory);
assert(output.startsWith(path.join(process.cwd(), ".cache") + "/"));
assert.equal(await realpath(path.dirname(output)), path.dirname(output));
const managed = await loadManagedInstance(identity.instanceId);
assert.equal(managed.manifest.root, process.cwd());
assert.equal(managed.manifest.purpose, identity.purpose);
assert.equal(managed.manifest.origin, identity.origin);
const sha = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const hash = (value: unknown) => sha(canonicalP1Json(value));
const original = quizPackContentV3Schema.parse(
  JSON.parse(await readFile(sourceFile, "utf8")),
);
assert.equal(
  hash(original),
  "8cbcf2488308c4f4962e9e9ee0aacf79f0dce1a3fb386133b81a0561edff7c31",
);
const sourceManifest = await readFile(
  path.join(intakeDirectory, "source-manifest.json"),
);
assert.equal(
  sha(sourceManifest),
  "b4c438519a334419fa71607d892a46b49a074da07212e1d586c7a4979490c923",
);
const art = JSON.parse(sourceManifest.toString());
const intake = JSON.parse(
  await readFile(path.join(intakeDirectory, "result.json"), "utf8"),
);
assert.equal(intake.status, "PASS_FROZEN_ART_TRANSFER_MAPPING_ONLY");
assert.equal(
  intake.archiveSha256,
  "e3bfb8831ef1e8e48ae64fea67aef19e18b0bcd741eb56f92d420ba585e63b86",
);
const resolved = JSON.parse(
  await readFile(path.join(intakeDirectory, "resolved-resources.json"), "utf8"),
) as {
  resources: {
    resource: { path: string; sha256: string; bytes: number };
    localPath: string;
  }[];
};
assert.equal(art.resources.length, 40);
assert.equal(art.shared.length, 13);
assert.equal(resolved.resources.length, 53);
const coverage = JSON.parse(await readFile(coverageFile, "utf8"));
assert.equal(coverage.sourceSha256, hash(original));
assert.equal(coverage.catalogueSha256, hash(QIANZAI_KNOWN_TEN_ROLES));
assert.equal(coverage.sampleCount, 4344);
assert.equal(coverage.newSearch, false);
const definition = qianzaiKnownScoringDefinition(
  scoringDefinitionV2Schema.parse(original.core.scoringDefinition),
);
assert.equal(coverage.definitionSha256, hash(definition));
const anyWitnesses = coverage.records.find(
  (r: { preference: string }) => r.preference === "any",
).witnesses;
const content = structuredClone(original),
  b = content.bindings;
content.core.scoringDefinition = definition;
content.core.results = QIANZAI_KNOWN_TEN_ROLES.map((role) => ({
  ref: { ...role.ref },
  label: role.displayName,
}));
content.core.provenance = content.core.provenance.map((row) =>
  row.kind === "personas"
    ? { ...row, sha256: hash(QIANZAI_KNOWN_TEN_ROLES) }
    : row,
);
assert.deepEqual(content.core.questions, original.core.questions);
assert.deepEqual(content.core.dimensions, original.core.dimensions);
assert.deepEqual(content.core.evidenceFamilies, original.core.evidenceFamilies);
assert.deepEqual(
  definition.questions,
  original.core.scoringDefinition.questions,
);
assert.deepEqual(
  definition.dimensions,
  original.core.scoringDefinition.dimensions,
);
assert.deepEqual(
  definition.matchingPolicy,
  original.core.scoringDefinition.matchingPolicy,
);
const templateBytes = await readFile(templateFile);
assert.equal(
  sha(templateBytes),
  "88c5171b12ffcb840f778f24b20767974633a91fb0bbd78ccece50c41ba7bbd1",
);
const shared = JSON.parse(
  templateBytes.toString(),
) as (typeof b.reportTemplates)[number];
const refKey = (ref: { productId: string; id: string; version: string }) =>
  canonicalP1Json(ref);
const declarations = new Map<string, (typeof shared.claims)[number]>();
const excludedRoleBoundClaim = "authored-03cf1d15d78b55a43fc4";
for (const template of original.bindings.reportTemplates)
  for (const claim of template.claims) {
    const key = refKey(claim.ref),
      before = declarations.get(key);
    assert(
      !before || canonicalP1Json(before) === canonicalP1Json(claim),
      "CONFLICTING_ORIGINAL_DECLARATION",
    );
    if (claim.ref.id !== excludedRoleBoundClaim) declarations.set(key, claim);
  }
assert.equal(declarations.size, 73);
assert.equal(shared.claims.length, 73);
assert.equal(shared.ref.id, "report-ten-literary-shared");
assert.equal(shared.ref.version, "2.0.0");
for (const claim of shared.claims) {
  assert.equal(
    canonicalP1Json(claim),
    canonicalP1Json(declarations.get(refKey(claim.ref))),
  );
  assert.equal(
    claim.when.selectedResultRef,
    null,
    "SHARED_CLAIM_MUST_REMAIN_ROLE_AGNOSTIC",
  );
}
assert(
  shared.volumes.every((v) =>
    v.claimRefs.every((ref) => ref.id !== excludedRoleBoundClaim),
  ),
);
const templateRef = shared.ref;
b.reportTemplates = [shared];
b.reportVersion = shared.ref.version;
b.resultReports = QIANZAI_KNOWN_TEN_ROLES.map((role) => ({
  resultRef: { ...role.ref },
  templateRef,
}));
b.witnesses.entries = QIANZAI_KNOWN_TEN_ROLES.map((role) => {
  const witness = anyWitnesses[role.id];
  assert(witness);
  return {
    expectedResultRef: { ...role.ref },
    preference: "any" as const,
    answers: witness.answers,
  };
});
const oldRoleResources = new Set(
  original.bindings.slots.characters.flatMap((role) => [
    role.reveal.id,
    role.report.id,
    role.poster.id,
    role.nameArt.id,
  ]),
);
b.resources = resolved.resources.map((r) => r.resource) as typeof b.resources;
b.slots.characters = art.characterSlots;
b.visualVersion = "3.0.0";
b.resourceVersion = "3.0.0";
b.privateTestUse = privateTestUseSchema.parse({
  schemaVersion: "quizforge.private-test-use.v1",
  instanceId: identity.instanceId,
  authorizationId: identity.authorizationId,
  contentStatus: "candidate",
  resourceStatus: "reference-or-candidate",
});
for (const [state, layout] of Object.entries(b.layouts)) {
  const uses =
    state === "result"
      ? (["reveal", "nameArt"] as const)
      : state === "report"
        ? (["report", "nameArt"] as const)
        : state === "poster"
          ? (["poster", "nameArt"] as const)
          : [];
  layout.resourceRefs = [
    ...layout.resourceRefs.filter((r) => !oldRoleResources.has(r.id)),
    ...b.slots.characters.flatMap((role) => uses.map((use) => role[use])),
  ];
}
b.visualPresentation.resourceDescriptions = [
  ...b.visualPresentation.resourceDescriptions.filter(
    (r) => !oldRoleResources.has(r.resourceRef.id),
  ),
  ...art.resources.map(
    (row: {
      roleId: string;
      use: "reveal" | "nameArt" | "report" | "poster";
      resourceRef: unknown;
    }) => ({
      resourceRef: row.resourceRef,
      alt:
        QIANZAI_KNOWN_TEN_ROLES.find((role) => role.id === row.roleId)!
          .displayName +
        {
          reveal: "揭晓立绘",
          nameArt: "姓名书法",
          report: "报告插画",
          poster: "海报插画",
        }[row.use],
    }),
  ),
];
const checked = quizPackContentV3Schema.parse(content);
const prepared = prepareContentV3(checked);
assert(prepared.ok, "KNOWN_TEN_PREPARATION_REJECTED");
const witnesses = verifyPreparedContentWitnessesV3(prepared.value);
assert(witnesses.ok, "KNOWN_TEN_EXISTING_WITNESS_REJECTED");
const text = canonicalP1Json(checked);
assert(Buffer.byteLength(text) <= 1_048_576);
await mkdir(output, { mode: 0o700 });
await writeFile(
  path.join(output, "intent.json"),
  JSON.stringify(
    {
      scope:
        "new exact content/resource staging only, no admission/import/DB writes",
      identity,
      baseSourceSha256: hash(original),
      artManifestSha256: sha(sourceManifest),
      sharedTemplateSha256: sha(templateBytes),
    },
    null,
    2,
  ) + "\n",
  { flag: "wx", mode: 0o600 },
);
for (const row of resolved.resources) {
  assert.equal(await realpath(row.localPath), row.localPath);
  assert(row.localPath.startsWith(intakeDirectory + "/"));
  const bytes = await readFile(row.localPath);
  assert.equal(bytes.length, row.resource.bytes);
  assert.equal(sha(bytes), row.resource.sha256);
  assert(
    /^assets\/[a-zA-Z0-9._-]+\.(webp|png|jpg|jpeg)$/.test(row.resource.path),
  );
  const target = path.join(output, row.resource.path);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
}
await writeFile(path.join(output, "content.json"), text + "\n", {
  flag: "wx",
  mode: 0o600,
});
const receipt = {
  status: "PASS_KNOWN_TEN_CONTENT_STAGING_ONLY",
  identity,
  canonicalContentSha256: sha(text),
  contentBytes: Buffer.byteLength(text),
  resources: 53,
  roleUses: 40,
  shared: 13,
  templates: 1,
  sharedClaims: 73,
  existingWitnesses: 10,
  witnessEvidence: witnesses.value,
  reusedCoverageSha256: sha(await readFile(coverageFile)),
  sourceAdmission: "NOT_RUN",
  fullQuizPack: "NOT_BUILT",
  fontCoverage: "NOT_RUN",
  createdAt: new Date().toISOString(),
};
await writeFile(
  path.join(output, "receipt.json"),
  JSON.stringify(receipt, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(
  JSON.stringify({ ...receipt, witnessEvidence: "in private receipt" }),
);
