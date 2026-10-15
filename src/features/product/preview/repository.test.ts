import type postgres from "postgres";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createContentV2Fixture } from "@/features/quizpack/content/fixtures.test-support";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import * as workspace from "../workspace/repository";
import {
  readFixedPreviewSource,
  resolveFixedPreviewResource,
} from "./repository";
afterEach(() => vi.restoreAllMocks());
async function setup() {
  vi.spyOn(workspace, "productRow").mockResolvedValue(
    {} as Awaited<ReturnType<typeof workspace.productRow>>,
  );
  const c = await createContentV2Fixture();
  const scope = {
    productId: c.product.productId,
    draftId: "11111111-1111-4111-8111-111111111111",
    revision: 1,
  };
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  const resources = c.resources
    .map((r) => ({
      productId: r.productId,
      resourceId: r.id,
      resourceVersion: r.version,
      blobSha256: r.sha256,
      declarationSha256: hash(canonicalP1Json(r)),
    }))
    .sort((a, b) => a.resourceId.localeCompare(b.resourceId));
  const text = canonicalP1Json(c),
    assetText = canonicalP1Json({
      schemaVersion: "quizpack-candidate-asset-set.v1",
      productId: scope.productId,
      resources,
    });
  const row = {
    product_id: scope.productId,
    draft_id: scope.draftId,
    revision: 1,
    canonical_content_text: text,
    canonical_content_sha256: hash(text),
    asset_set_text: assetText,
    asset_set_sha256: hash(assetText),
    resource_count: 5,
    content_schema_version: c.schemaVersion,
    content_kind: c.kind,
    content_version: c.contentVersion,
    visual_version: c.visualVersion,
    report_version: c.reportVersion,
    resource_version: c.resourceVersion,
    component_version: c.componentVersion,
    engine_id: c.engine.id,
    engine_version: String(c.engine.version),
  };
  const assets = c.resources.map((r) => ({
    product_id: r.productId,
    resource_id: r.id,
    resource_version: r.version,
    blob_sha256: r.sha256,
    declaration_text: canonicalP1Json(r),
    declaration_sha256: hash(canonicalP1Json(r)),
    purpose: r.purpose,
    platform_approval: "unverified",
    blob_hash: r.sha256,
    blob_bytes: r.bytes,
    media_type: r.mediaType,
    width: r.width,
    height: r.height,
    frames: 1,
    storage_key: `blobs/${r.sha256}.blob`,
  }));
  const queries: string[] = [];
  const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
    const sql = strings.join("?");
    queries.push(sql);
    if (sql.includes("FROM qf.draft_revision")) return Promise.resolve([row]);
    return Promise.resolve(assets.filter((r) => r.resource_id === args[1]));
  }) as unknown as postgres.TransactionSql;
  return { c, scope, row, assets, tx, queries };
}
it("validates server snapshot and image query never reads content/evidence or first-source identity", async () => {
  const f = await setup();
  const fixed = await readFixedPreviewSource(f.tx, f.scope);
  expect(fixed.content).toEqual(f.c);
  f.queries.length = 0;
  await resolveFixedPreviewResource(f.tx, f.scope, f.c.resources[0]!);
  expect(f.queries.join(" ")).not.toMatch(
    /canonical_content_text|evidence|source_validation_id/,
  );
});
it.each([
  "content hash",
  "noncanonical content",
  "asset hash",
  "resource count",
  "metadata",
  "declaration",
  "mime",
  "storage key",
])("rejects %s before exposing source", async (kind) => {
  const f = await setup();
  if (kind === "content hash") f.row.canonical_content_sha256 = "f".repeat(64);
  if (kind === "noncanonical content") {
    f.row.canonical_content_text = JSON.stringify(f.c);
    f.row.canonical_content_sha256 = createHash("sha256")
      .update(f.row.canonical_content_text)
      .digest("hex");
  }
  if (kind === "asset hash") f.row.asset_set_sha256 = "f".repeat(64);
  if (kind === "resource count") f.row.resource_count = 4;
  if (kind === "metadata") f.row.engine_version = "2.0.0";
  if (kind === "declaration") f.assets[0]!.declaration_text = "{}";
  if (kind === "mime") f.assets[0]!.media_type = "image/jpeg";
  if (kind === "storage key") f.assets[0]!.storage_key = "other-file";
  await expect(readFixedPreviewSource(f.tx, f.scope)).rejects.toMatchObject({
    code: expect.stringMatching(/^PREVIEW_(UNSUPPORTED|RESOURCE_UNAVAILABLE)$/),
  });
});
