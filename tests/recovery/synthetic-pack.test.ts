import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readRestrictedZip } from "@/features/quizpack/v1/zip";
import { createStoredArchive } from "@/features/quizpack/v1/build";
import { PACK_LIMITS } from "@/features/quizpack/v1/limits";
import { validateSupportedQuizPack } from "@/features/quizpack/package/validate";
import {
  buildRecoverySyntheticPack,
  RECOVERY_SYNTHETIC_BASELINE,
} from "./synthetic-pack";

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
async function* source(bytes: Uint8Array) {
  yield bytes;
}

describe("recovery real synthetic archive", () => {
  it("contains the exact registered documents and all five actual PNG files", async () => {
    const pack = await buildRecoverySyntheticPack();
    const zip = await readRestrictedZip(source(pack.archive), {
      targetProductId: RECOVERY_SYNTHETIC_BASELINE.productId,
    });
    expect(zip.ok).toBe(true);
    if (!zip.ok) throw Error("RECOVERY_TEST_ZIP_INVALID");
    const files = zip.value.files;
    expect(files.size).toBe(7);
    expect(sha(files.get("manifest.json")!)).toBe(pack.baseline.manifestSha256);
    expect(sha(files.get("content.json")!)).toBe(pack.baseline.contentSha256);
    const manifest = JSON.parse(files.get("manifest.json")!.toString());
    for (const declaration of manifest.files) {
      const bytes = files.get(declaration.path)!;
      expect(bytes.length).toBe(declaration.bytes);
      expect(sha(bytes)).toBe(declaration.sha256);
    }
    expect(pack.archiveBytes).toBe(pack.archive.length);
    expect(pack.archiveSha256).toBe(sha(pack.archive));
    expect(pack.report).toMatchObject({
      candidateValid: true,
      importable: false,
      publishable: false,
    });
    expect(pack.report.unverified.length).toBeGreaterThan(0);
    const second = await buildRecoverySyntheticPack();
    expect(second.archive).toEqual(pack.archive);
  });

  it("rejects changed asset bytes through the real package validator", async () => {
    const pack = await buildRecoverySyntheticPack();
    const context = { targetProductId: pack.baseline.productId };
    const zip = await readRestrictedZip(source(pack.archive), context);
    if (!zip.ok) throw Error("RECOVERY_TEST_ZIP_INVALID");
    const files = [...zip.value.files].map(([path, original]) => {
      const bytes = Buffer.from(original);
      if (path === "assets/portrait-1.png") bytes[bytes.length - 1]! ^= 1;
      return { path, bytes };
    });
    const corrupt = await createStoredArchive(
      files,
      PACK_LIMITS.archiveBytes,
      new AbortController().signal,
    );
    const report = await validateSupportedQuizPack(
      source(corrupt),
      context,
      "quizpack-content.v2",
    );
    expect(report.candidateValid).toBe(false);
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it("does not start building after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      buildRecoverySyntheticPack(controller.signal),
    ).rejects.toThrow();
  });
});
