/** Offline pack construction with the existing DB-issued private capability.
 * No import, asset storage, source admission, play, activation or grants. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import registration from "../src/features/quizpack/content/private-test-registration-known-ten-final.json";
import { loadRuntimeConfig } from "../src/lib/db/runtime";
import { createDatabase } from "../src/lib/db/client";
import { issuePrivateTestCapability } from "../src/features/quizpack/private-test-scope";
import { buildPrivateTestQuizPack } from "../src/features/quizpack/private-test-build";
import { quizPackContentV3Schema } from "../src/features/quizpack/content/v3";
import { canonicalP1Json } from "../src/features/quizpack/v1/canonical";
import { writeArchiveNoClobber } from "../src/features/quizpack/v1/io";

const [directory] = process.argv.slice(2);
assert(directory && process.argv.length === 3);
const root = await realpath(process.cwd());
const candidate = await realpath(directory);
assert(candidate.startsWith(root + "/.cache/known-ten/"));
const config = await loadRuntimeConfig();
assert.equal(config.instanceId, registration.instanceId);
assert.equal(config.purpose, "test");
assert.equal(config.origin, registration.origin);
assert.equal(config.database.port, 55537);
const content = quizPackContentV3Schema.parse(
  JSON.parse(await readFile(path.join(candidate, "content.json"), "utf8")),
);
const sha = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
assert.equal(
  sha(canonicalP1Json(content)),
  registration.canonicalContentSha256,
);
const assets = [];
for (const r of content.bindings.resources) {
  const file = path.join(candidate, r.path);
  assert(file.startsWith(candidate + "/assets/"));
  assert.equal(await realpath(file), file);
  const bytes = await readFile(file);
  assert.equal(bytes.length, r.bytes);
  assert.equal(sha(bytes), r.sha256);
  assets.push({ path: r.path, bytes });
}
const db = await createDatabase(config);
let result;
try {
  const capability = await issuePrivateTestCapability(db);
  result = await buildPrivateTestQuizPack(
    {
      packId: "qianzai-tongxin-known-ten",
      packVersion: "3.0.0",
      content,
      assets,
    },
    { targetProductId: registration.productId },
    capability,
  );
} finally {
  await db.close();
}
if (!result.ok) {
  await writeFile(
    path.join(candidate, "private-pack-failure.json"),
    JSON.stringify({ result, databaseClose: "CONFIRMED" }, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  throw Error("PRIVATE_PACK_REJECTED");
}
assert.equal(
  result.value.report.manifestSha256,
  registration.canonicalManifestSha256,
);
const output = await writeArchiveNoClobber(
  path.join(candidate, "known-ten.zip"),
  result.value.archive,
  new AbortController().signal,
);
const receipt = {
  status: "PASS_PRIVATE_PACK_BUILD_ONLY",
  registration,
  archive: {
    ...output,
    sha256: sha(result.value.archive),
    bytes: result.value.archive.length,
  },
  report: result.value.report,
  databaseClose: "CONFIRMED",
  nativeSourceAdmission: "NOT_RUN",
  imported: false,
};
await writeFile(
  path.join(candidate, "private-pack-receipt.json"),
  JSON.stringify(receipt, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(
  JSON.stringify({
    status: receipt.status,
    manifestSha256: result.value.report.manifestSha256,
    archiveSha256: receipt.archive.sha256,
    bytes: receipt.archive.bytes,
    databaseClose: receipt.databaseClose,
    imported: false,
  }),
);
