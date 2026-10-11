import { beforeAll, describe, expect, it } from "vitest";
import { buildQuizPack, createStoredArchive } from "./build";
import { DEFAULT_COMPATIBILITY_POLICY } from "./compatibility";
import {
  createSyntheticFixture,
  type SyntheticFixture,
} from "./fixtures/synthetic";
import { canonicalPackJson } from "./io";
import { PACK_LIMITS } from "./limits";
import { hashBytes, validateQuizPack } from "./validate";
import { readRestrictedZip } from "./zip";
import type { BuildInput, TrustedCompatibilityPolicy } from "./api";
const source = async function* (bytes: Uint8Array) {
  yield bytes;
};
let fixture: SyntheticFixture;
let archive: Uint8Array;
const input = (): BuildInput => ({
  packId: "synthetic-pack",
  packVersion: "1.0.0",
  content: structuredClone(fixture.content),
  assets: fixture.assets.map((asset) => ({
    path: asset.path,
    bytes: Buffer.from(asset.bytes),
  })),
});
async function repack(
  edit: (files: Map<string, Buffer>) => void,
): Promise<Uint8Array> {
  const parsed = await readRestrictedZip(source(archive), {
    targetProductId: fixture.content.product.productId,
  });
  if (!parsed.ok) throw new Error("fixture failed");
  const files = new Map(parsed.value.files);
  edit(files);
  return createStoredArchive(
    [...files].map(([path, bytes]) => ({ path, bytes })),
    PACK_LIMITS.archiveBytes,
    new AbortController().signal,
  );
}
const check = (bytes: Uint8Array, context = {}) =>
  validateQuizPack(source(bytes), {
    targetProductId: fixture.content.product.productId,
    ...context,
  });
const rewrite = (
  files: Map<string, Buffer>,
  name: string,
  edit: (value: Record<string, unknown>) => void,
  rehash = false,
) => {
  const value = JSON.parse(files.get(name)!.toString()) as Record<
    string,
    unknown
  >;
  edit(value);
  files.set(name, Buffer.from(JSON.stringify(value)));
  if (rehash) {
    const manifest = JSON.parse(files.get("manifest.json")!.toString());
    const declaration = manifest.files.find(
      (file: { path: string }) => file.path === name,
    );
    declaration.bytes = files.get(name)!.length;
    declaration.sha256 = hashBytes(files.get(name)!);
    files.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
  }
};
beforeAll(async () => {
  fixture = await createSyntheticFixture("archetype");
  const built = await buildQuizPack(input(), {
    targetProductId: fixture.content.product.productId,
  });
  expect(built.ok).toBe(true);
  if (!built.ok) throw new Error(JSON.stringify(built));
  archive = built.value.archive;
}, 30000);
describe("QuizPack build and validation", () => {
  it.each(["dimensions", "archetype"] as const)(
    "roundtrips %s with immutable evidence and no authority",
    async (engine) => {
      const pack = await createSyntheticFixture(engine);
      const built = await buildQuizPack(
        {
          packId: "synthetic-pack",
          packVersion: "1.0.0",
          content: pack.content,
          assets: pack.assets,
        },
        { targetProductId: pack.content.product.productId },
      );
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      const report = built.value.report;
      expect(report).toMatchObject({
        candidateValid: true,
        importable: false,
        publishable: false,
        issues: [],
        issuesTruncated: false,
        archiveSha256: hashBytes(built.value.archive),
        contentSha256: hashBytes(canonicalPackJson(pack.content)),
        effectiveLimitsHash: hashBytes(canonicalPackJson(PACK_LIMITS)),
        compatibilityPolicyHash: hashBytes(
          canonicalPackJson(DEFAULT_COMPATIBILITY_POLICY),
        ),
      });
      expect(Object.values(report.checks)).toEqual(Array(6).fill("passed"));
      expect(report.unverified).toHaveLength(5);
    },
  );
  it("preserves canonical ordering, STORE profile, DOS time and mode", async () => {
    const reversed = input();
    reversed.assets = [...reversed.assets].reverse();
    const built = await buildQuizPack(reversed, {
      targetProductId: fixture.content.product.productId,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.archive).toEqual(archive);
    const bytes = Buffer.from(archive);
    expect(bytes.readUInt16LE(8)).toBe(0);
    expect(bytes.readUInt16LE(10)).toBe(0);
    expect(bytes.readUInt16LE(12)).toBe(33);
    const central = bytes.readUInt32LE(bytes.length - 6);
    expect(bytes.readUInt32LE(central + 38) >>> 16).toBe(0o100644);
  });
  it("binds failed-container archive evidence and leaves later checks not-run", async () => {
    const bytes = Buffer.from(archive);
    bytes[0] = 0;
    const report = await check(bytes);
    expect(report.archiveSha256).toBe(hashBytes(bytes));
    expect(report.checks).toMatchObject({
      container: "failed",
      structure: "not-run",
      integrity: "not-run",
      media: "not-run",
    });
    expect(report.candidateValid).toBe(false);
  });
  it("rejects required JSON omission, invalid UTF8, duplicate keys and unknown fields", async () => {
    const cases = [
      (files: Map<string, Buffer>) => {
        files.delete("manifest.json");
      },
      (files: Map<string, Buffer>) => {
        files.set("content.json", Buffer.from([0xff]));
      },
      (files: Map<string, Buffer>) => {
        files.set("content.json", Buffer.from('{"x":1,"x":2}'));
      },
      (files: Map<string, Buffer>) => {
        rewrite(files, "content.json", (content) => {
          content.unknown = true;
        });
      },
    ];
    for (const edit of cases) {
      const report = await check(await repack(edit));
      expect(report.checks.structure).toBe("failed");
      expect(report.checks.media).toBe("not-run");
    }
  });
  it("rejects manifest missing/extra/duplicate paths and false bytes/hash", async () => {
    for (const edit of [
      (manifest: Record<string, unknown>) => {
        (manifest.files as unknown[]).pop();
      },
      (manifest: Record<string, unknown>) => {
        const files = manifest.files as { path: string }[];
        files.push({ ...files[0]!, path: "assets/absent.png" });
      },
      (manifest: Record<string, unknown>) => {
        const files = manifest.files as unknown[];
        files.push(files[0]);
      },
      (manifest: Record<string, unknown>) => {
        (manifest.files as { bytes: number }[])[0]!.bytes++;
      },
      (manifest: Record<string, unknown>) => {
        (manifest.files as { sha256: string }[])[0]!.sha256 = "0".repeat(64);
      },
    ]) {
      const report = await check(
        await repack((files) => rewrite(files, "manifest.json", edit)),
      );
      expect(report.checks.integrity).toBe("failed");
      expect(report.checks.media).toBe("not-run");
    }
  });
  it("rejects foreign Product and version references without granting candidate validity", async () => {
    const foreign = await check(archive, { targetProductId: "other-product" });
    expect(foreign.checks.references).toBe("failed");
    const bad = await repack((files) =>
      rewrite(
        files,
        "content.json",
        (content) => {
          const results = content.results as {
            portraitRef: { version: string };
          }[];
          results[0]!.portraitRef.version = "2.0.0";
        },
        true,
      ),
    );
    const report = await check(bad);
    expect(report.checks.references).toBe("failed");
    expect(report.candidateValid).toBe(false);
    expect(
      report.issues.some(
        (issue) => issue.code === "REFERENCE_VERSION_OR_OWNER_MISMATCH",
      ),
    ).toBe(true);
  });
  it("rejects incompatible policy and honors issue truncation", async () => {
    const report = await check(archive, {
      compatibilityPolicy: {
        contentSchemaVersions: [],
        engines: [],
        components: [],
      },
      limits: { issues: 1 },
    });
    expect(report.checks.compatibility).toBe("failed");
    expect(report.issues).toHaveLength(1);
    expect(report.issuesTruncated).toBe(true);
    expect(report.candidateValid).toBe(false);
  });
  it("snapshots policy and effective limits before source awaits", async () => {
    const policy = structuredClone(
      DEFAULT_COMPATIBILITY_POLICY,
    ) as TrustedCompatibilityPolicy;
    const limits = { questions: 2 };
    let resume!: () => void;
    const wait = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const stream = async function* () {
      await wait;
      yield archive;
    };
    const checking = validateQuizPack(stream(), {
      targetProductId: fixture.content.product.productId,
      compatibilityPolicy: policy,
      limits,
    });
    (policy.components as unknown[]).length = 0;
    limits.questions = 1;
    resume();
    const report = await checking;
    expect(report.candidateValid).toBe(true);
    expect(report.compatibilityPolicyHash).toBe(
      hashBytes(canonicalPackJson(DEFAULT_COMPATIBILITY_POLICY)),
    );
    expect(report.effectiveLimitsHash).toBe(
      hashBytes(canonicalPackJson({ ...PACK_LIMITS, questions: 2 })),
    );
  });
  it("snapshots builder content and asset bytes before asynchronous work", async () => {
    const value = input();
    const building = buildQuizPack(value, {
      targetProductId: fixture.content.product.productId,
    });
    (value.content as typeof fixture.content).product.productId =
      "mutated-product";
    value.assets[0]!.bytes.fill(0);
    const result = await building;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.archive).toEqual(archive);
  });
  it("never repairs declared bytes/hash/size or accepts undeclared assets", async () => {
    for (const field of ["bytes", "sha256", "width"] as const) {
      const value = input();
      const content = value.content as typeof fixture.content;
      if (field === "sha256") content.resources[0]!.sha256 = "0".repeat(64);
      else content.resources[0]![field]++;
      const result = await buildQuizPack(value, {
        targetProductId: fixture.content.product.productId,
      });
      expect(result.ok).toBe(false);
    }
    for (const edit of [
      (value: BuildInput) => {
        value.assets = [];
      },
      (value: BuildInput) => {
        value.assets = [...value.assets, value.assets[0]!];
      },
      (value: BuildInput) => {
        value.assets = [
          ...value.assets,
          { path: "assets/extra.png", bytes: fixture.assets[0]!.bytes },
        ];
      },
    ]) {
      const value = input();
      edit(value);
      expect(
        (
          await buildQuizPack(value, {
            targetProductId: fixture.content.product.productId,
          })
        ).ok,
      ).toBe(false);
    }
  });
  it("honors lowered content/media limits and invalid overrides", async () => {
    for (const limits of [
      { questions: 1 },
      { optionsPerQuestion: 2 },
      { dimensions: 1 },
      { results: 2 },
      { imagePixels: 1 },
      { imageDimension: 1 },
      { jsonDepth: 1 },
    ]) {
      const report = await check(archive, { limits });
      expect(report.candidateValid).toBe(false);
      expect(report.checks.media).toBe("not-run");
    }
    expect(
      (await check(archive, { limits: { questions: 101 } })).issues[0]?.code,
    ).toBe("INVALID_LIMITS");
  });
  it("closes cancelled/stalled inputs and does not expose source errors", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      (await check(archive, { signal: controller.signal })).issues[0]?.code,
    ).toBe("OPERATION_CANCELLED");
    const report = await validateQuizPack(
      (async function* () {
        throw new Error("/private/credential");
        yield archive;
      })(),
      { targetProductId: fixture.content.product.productId },
    );
    expect(JSON.stringify(report)).not.toContain("credential");
    expect(report.checks.container).toBe("failed");
  });
  it("caps build structure issues and explicitly marks overflow", async () => {
    const value = input();
    value.content = { schemaVersion: "invalid" };
    const result = await buildQuizPack(value, {
      targetProductId: fixture.content.product.productId,
      limits: { issues: 1 },
    });
    expect(result).toMatchObject({ ok: false, issuesTruncated: true });
    if (!result.ok) expect(result.issues).toHaveLength(1);
  });
  it("rejects asset accessors before invoking them", async () => {
    const value = input();
    let invoked = false;
    Object.defineProperty(value.assets, "0", {
      enumerable: true,
      configurable: true,
      get() {
        invoked = true;
        return fixture.assets[0];
      },
    });
    const result = await buildQuizPack(value, {
      targetProductId: fixture.content.product.productId,
    });
    expect(result.ok).toBe(false);
    expect(invoked).toBe(false);
  });
  it("keeps the whole deadline through builder snapshotting and validation", async () => {
    const result = await buildQuizPack(input(), {
      targetProductId: fixture.content.product.productId,
      limits: { operationMs: 1 },
    });
    expect(result.ok ? "OK" : result.issues[0]?.code).toBe("OPERATION_TIMEOUT");
  });
  it("bounds aggregate build payload before buffering the full asset set", async () => {
    const result = await buildQuizPack(input(), {
      targetProductId: fixture.content.product.productId,
      limits: { totalUncompressedBytes: 1 },
    });
    expect(result.ok ? "OK" : result.issues[0]?.code).toBe("BUILD_TOTAL_LIMIT");
  });
});
