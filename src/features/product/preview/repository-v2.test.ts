import type postgres from "postgres";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import * as workspace from "../workspace/repository";
import * as legacy from "./repository";
import { readCurrentPreviewSource } from "./repository-v2";
import { temporaryPreviewFixtureV2 } from "./v2.test-support";
let f: Awaited<ReturnType<typeof temporaryPreviewFixtureV2>>;
beforeAll(async () => {
  f = await temporaryPreviewFixtureV2();
});
afterEach(() => vi.restoreAllMocks());
function setup() {
  const row = structuredClone(f.row),
    statements: string[] = [];
  vi.spyOn(workspace, "productRow").mockResolvedValue({} as never);
  const resolve = vi
    .spyOn(legacy, "resolveFixedPreviewResource")
    .mockImplementation(async (_tx, _scope, ref) => {
      const r = f.content.bindings.resources.find((r) => r.id === ref.id)!;
      return {
        binding: { ...f.binding, schemaVersion: undefined } as never,
        resource: {
          resourceRef: ref,
          sha256: r.sha256,
          bytes: r.bytes,
          mediaType: r.mediaType,
          width: r.width,
          height: r.height,
        },
      };
    });
  const tx = ((strings: TemplateStringsArray) => {
    statements.push(strings.join("?"));
    return Promise.resolve([row]);
  }) as unknown as postgres.TransactionSql;
  return { row, tx, statements, resolve };
}
it("reads bounded immutable v3 bytes and uses the existing alias/blob guard for every declared resource", async () => {
  const { tx, resolve, statements } = setup();
  const result = await readCurrentPreviewSource(tx, f.scope);
  expect(result.mode).toBe("structured");
  expect(result.binding.canonicalContentSha256).toBe(
    f.binding.canonicalContentSha256,
  );
  expect(resolve).toHaveBeenCalledTimes(f.content.bindings.resources.length);
  expect(statements.join(" ")).toContain(
    "octet_length(canonical_content_text)<=2097152",
  );
  expect(statements.join(" ")).not.toMatch(
    /INSERT|UPDATE|DELETE|current_revision|access_key|consumer_report/,
  );
});
it.each(["content hash", "metadata", "asset count", "unknown schema"])(
  "rejects %s before exposing a structured source",
  async (kind) => {
    const { row, tx } = setup();
    if (kind === "content hash") row.canonical_content_sha256 = "f".repeat(64);
    if (kind === "metadata") row.report_version = "9.0.0";
    if (kind === "asset count") row.resource_count--;
    if (kind === "unknown schema")
      Object.assign(row, { content_schema_version: "quizpack-content.v99" });
    await expect(readCurrentPreviewSource(tx, f.scope)).rejects.toMatchObject({
      code: "PREVIEW_UNSUPPORTED",
    });
  },
);
it("propagates the existing resource guard failure without treating a different revision binding as valid", async () => {
  const { tx, resolve } = setup();
  resolve.mockRejectedValueOnce(new Error("synthetic guard failure"));
  await expect(readCurrentPreviewSource(tx, f.scope)).rejects.toThrow(
    "synthetic guard failure",
  );
  resolve.mockResolvedValueOnce({
    binding: { ...f.binding, canonicalContentSha256: "f".repeat(64) } as never,
    resource: {} as never,
  });
  await expect(readCurrentPreviewSource(tx, f.scope)).rejects.toMatchObject({
    code: "PREVIEW_BINDING_MISMATCH",
  });
});
