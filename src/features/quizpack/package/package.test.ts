import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CURRENT_COMPATIBILITY_HASH,
  CURRENT_REPORT_VERSION,
  CURRENT_POLICY_ID,
  CURRENT_VALIDATOR_VERSION,
} from "./current-compatibility";
import type { BuildInput, PackIssue } from "../v1/api";
import type {
  ContentSchemaVersion,
  SupportedCoreExecution,
  SupportedValidationContext,
} from "./api";
import { buildQuizPack, createStoredArchive } from "../v1/build";
import { createSyntheticFixture } from "../v1/fixtures/synthetic";
import { createContentV2Fixture } from "../content/fixtures.test-support";
import { canonicalPackJson } from "../v1/io";
import { PACK_LIMITS } from "../v1/limits";
import {
  getQuizPackManifestJsonSchema,
  parseQuizPackManifest,
} from "../v1/manifest";
import { validateContentReferences } from "../v1/references";
import { hashBytes, validateQuizPack } from "../v1/validate";
import {
  validateQuizPackCore,
  type P1CoreExecution,
} from "../v1/validate-core";
import { inspectImage } from "../v1/media";
import { readRestrictedZip, throwIfAborted, withPackDeadline } from "../v1/zip";
import { buildSupportedQuizPack } from "./build";
import { SUPPORTED_COMPATIBILITY_HASH } from "./compatibility";
import { collectIssues } from "./issues";
import { validateContentGraph } from "../content/reference-graph";
import { validatePresentationReferences } from "../content/references";
import { V2_STATE_COMPONENT_CONTRACTS } from "../content/v2";
import {
  getSupportedManifestJsonSchema,
  parseSupportedManifest,
  parseSupportedPack,
} from "./manifest";
import { validateSupportedPackReferences } from "./references";
import { validateSupportedQuizPack } from "./validate";
import { validateSupportedQuizPackCore } from "./validate-core";

const source = async function* (bytes: Uint8Array) {
  yield bytes;
};
const expected = "quizpack-content.v1" as const;
let v1: Awaited<ReturnType<typeof createSyntheticFixture>>;
let archive: Uint8Array;
let context: SupportedValidationContext;
const makeInput = (content: unknown, assets = v1.assets): BuildInput => ({
  packId: "synthetic-pack",
  packVersion: "1.0.0",
  content,
  assets,
});
const execution = (events: string[] = []): SupportedCoreExecution => ({
  execute: (work) => withPackDeadline(context, work),
  checkpoint: throwIfAborted,
  readZip: (input, value) => {
    expect(value).not.toHaveProperty("compatibilityPolicy");
    return readRestrictedZip(input, value);
  },
  inspect: async (...args) => {
    events.push("inspect");
    return inspectImage(args[0], args[1], args[2]);
  },
  beforeStructure: () => {
    events.push("structure");
  },
  parsed: () => {
    events.push("parsed");
  },
  propagate: () => false,
});
async function repack(
  edit: (manifest: Record<string, unknown>, content: typeof v1.content) => void,
) {
  const zip = await readRestrictedZip(source(archive), context);
  if (!zip.ok) throw new Error("fixture");
  const files = new Map(zip.value.files);
  const manifest = JSON.parse(files.get("manifest.json")!.toString());
  const content = JSON.parse(files.get("content.json")!.toString());
  edit(manifest, content);
  files.set("content.json", Buffer.from(canonicalPackJson(content)));
  const declaration = manifest.files.find(
    (file: { path: string }) => file.path === "content.json",
  );
  declaration.bytes = files.get("content.json")!.length;
  declaration.sha256 = hashBytes(files.get("content.json")!);
  files.set("manifest.json", Buffer.from(canonicalPackJson(manifest)));
  return createStoredArchive(
    [...files].map(([path, bytes]) => ({ path, bytes })),
    PACK_LIMITS.archiveBytes,
    new AbortController().signal,
  );
}
beforeAll(async () => {
  v1 = await createSyntheticFixture("archetype");
  context = { targetProductId: v1.content.product.productId };
  const built = await buildQuizPack(makeInput(v1.content), context);
  if (!built.ok) throw new Error(JSON.stringify(built));
  archive = built.value.archive;
}, 30000);

describe("supported complete package admission", () => {
  it.each(["quizpack-content.v1", "quizpack-content.v2"] as const)(
    "roundtrips synthetic/authored %s with real declared asset bytes",
    async (version) => {
      const content =
        version === expected
          ? structuredClone(v1.content)
          : await createContentV2Fixture();
      const assets =
        version === expected
          ? v1.assets
          : [
              ...v1.assets,
              { path: "assets/neutral-scene.png", bytes: v1.assets[0]!.bytes },
            ];
      for (const kind of ["synthetic", "authored"] as const) {
        content.kind = kind;
        const built = await buildSupportedQuizPack(
          makeInput(content, assets),
          context,
          version,
        );
        expect(built.ok, JSON.stringify(built)).toBe(true);
        if (!built.ok) continue;
        expect(built.value.report).toMatchObject({
          schemaVersion: "quizpack-validation.v2",
          validatorVersion: "2.0.0",
          policyId: "quizpack-local-supported.v1",
          compatibilityPolicyHash: SUPPORTED_COMPATIBILITY_HASH,
          candidateValid: true,
          importable: false,
          publishable: false,
          issues: [],
          issuesTruncated: false,
        });
        expect(built.value.report.unverified).toHaveLength(5);
        const checked = await validateSupportedQuizPack(
          source(built.value.archive),
          context,
          version,
        );
        expect(checked).toEqual(built.value.report);
        const matrix = await validateSupportedQuizPackCore(
          source(built.value.archive),
          context,
          execution(),
          { kind: "backend-matrix" },
        );
        expect(matrix).toEqual({
          ...checked,
          schemaVersion: CURRENT_REPORT_VERSION,
          validatorVersion: CURRENT_VALIDATOR_VERSION,
          policyId: CURRENT_POLICY_ID,
          compatibilityPolicyHash: CURRENT_COMPATIBILITY_HASH,
        });
        if (version !== expected)
          expect(
            (await validateQuizPack(source(built.value.archive), context))
              .candidateValid,
          ).toBe(false);
      }
    },
    30000,
  );
  it.each(["dimensions", "archetype"] as const)(
    "preserves legacy %s ZIP bytes and old reports",
    async (engine) => {
      const fixture = await createSyntheticFixture(engine),
        input = {
          ...makeInput(fixture.content, fixture.assets),
          packId: fixture.manifest.packId,
        },
        target = { targetProductId: fixture.content.product.productId };
      const old = await buildQuizPack(input, target),
        current = await buildSupportedQuizPack(input, target, expected);
      expect(old.ok && current.ok).toBe(true);
      if (!old.ok || !current.ok) return;
      expect(current.value.archive).toEqual(old.value.archive);
      expect(old.value.report.schemaVersion).toBe("quizpack-validation.v1");
      expect(hashBytes(old.value.archive)).toBe(
        engine === "dimensions"
          ? "9e377ab8f3fec0dbf28aeccdbbc092c4131b201b9f558be8f3961f759d6f23a0"
          : "3380e32b52d12e223dfbceb77d5079f602ca8f14e68adb80b6fa4bc7d6088076",
      );
    },
    30000,
  );
  it("requires an explicit full version and rejects manifest/content/expected mismatches before media", async () => {
    for (const version of [undefined, "v1", "quizpack-content.v2"]) {
      const report = await validateSupportedQuizPack(
        source(archive),
        context,
        version as ContentSchemaVersion,
      );
      expect(report.candidateValid).toBe(false);
      expect(report.checks.media).toBe("not-run");
    }
    const wrong = await repack((manifest) => {
      manifest.contentSchemaVersion = "quizpack-content.v2";
    });
    const inspect = vi.fn(execution().inspect);
    const report = await validateSupportedQuizPackCore(
      source(wrong),
      context,
      { ...execution(), inspect },
      { kind: "backend-matrix" },
    );
    expect(report.issues[0]).toMatchObject({
      code: "CONTENT_DECLARATION_MISMATCH",
      path: ["contentSchemaVersion"],
    });
    expect(inspect).not.toHaveBeenCalled();
    const built = await buildSupportedQuizPack(
      makeInput(v1.content),
      context,
      "quizpack-content.v2",
    );
    expect(built.ok).toBe(false);
  });
  it("rejects unknown/mixed components and review envelopes without repairing declarations", async () => {
    const mixed = await repack((manifest) => {
      (manifest.components as { version: string }[])[0]!.version = "2.0.0";
    });
    const report = await validateSupportedQuizPack(
      source(mixed),
      context,
      expected,
    );
    expect(report.checks.compatibility).toBe("failed");
    expect(
      report.issues.some((issue) => issue.code === "UNSUPPORTED_COMPONENT"),
    ).toBe(true);
    const envelope = await buildSupportedQuizPack(
      makeInput({ status: "authored-pending", content: v1.content }),
      context,
      expected,
    );
    expect(envelope.ok).toBe(false);
  });
  it("uses ordinary manifest snapshots and retains legacy literal schema", () => {
    expect(getSupportedManifestJsonSchema(expected)).toEqual(
      getQuizPackManifestJsonSchema(),
    );
    expect(
      getSupportedManifestJsonSchema("quizpack-content.v2").properties
        ?.contentSchemaVersion,
    ).toMatchObject({ const: "quizpack-content.v2" });
    const value = {
      ...v1.manifest,
      contentSchemaVersion: "quizpack-content.v2",
    };
    expect(parseSupportedManifest(value).ok).toBe(true);
    expect(parseQuizPackManifest(value).ok).toBe(false);
    const getter = vi.fn();
    expect(
      parseSupportedManifest({
        ...value,
        get unknown() {
          return getter();
        },
      }).ok,
    ).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(parseSupportedManifest({ ...value, unknown: true }).ok).toBe(false);
    expect(
      parseSupportedManifest({
        ...value,
        contentSchemaVersion: "quizpack-content.v3",
      }).ok,
    ).toBe(false);
  });
  it("composes the full v1 graph exactly once and keeps full issue order", () => {
    const changed = structuredClone(v1.content);
    changed.product.productId = "foreign-product";
    changed.results[0]!.portraitRef.version = "9.0.0";
    const parsed = parseSupportedPack(v1.manifest, changed, {
      kind: "backend-matrix",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      validateSupportedPackReferences(parsed.value, context.targetProductId),
    ).toEqual(
      collectIssues(
        validateContentReferences(
          v1.manifest,
          changed,
          context.targetProductId,
        ),
        100,
      ),
    );
  });
  it("adds v2 presentation edges after one complete base closure", async () => {
    const content = await createContentV2Fixture();
    content.results[0]!.portraitRef.version = "9.0.0";
    content.visualPresentation.questionFrames[0]!.questionRef.version = "9.0.0";
    content.visualPresentation.resourceDescriptions[0]!.resourceRef.version =
      "9.0.0";
    const manifest = {
      ...v1.manifest,
      contentSchemaVersion: "quizpack-content.v2",
      components: v1.manifest.components.map((component) => ({
        ...component,
        version: "2.0.0",
      })),
      files: [
        ...v1.manifest.files,
        {
          path: content.resources.at(-1)!.path,
          mediaType: "image/png",
          bytes: content.resources.at(-1)!.bytes,
          sha256: content.resources.at(-1)!.sha256,
        },
      ],
    };
    const parsed = parseSupportedPack(manifest, content, {
      kind: "backend-matrix",
    });
    expect(parsed.ok).toBe(true);
    if (
      !parsed.ok ||
      parsed.value.contentSchemaVersion !== "quizpack-content.v2"
    )
      return;
    const issues = validateSupportedPackReferences(
      parsed.value,
      context.targetProductId,
    );
    expect(issues).toEqual(
      collectIssues(
        [
          ...validateContentGraph(
            content,
            context.targetProductId,
            V2_STATE_COMPONENT_CONTRACTS,
            parsed.value.manifest,
          ),
          ...validatePresentationReferences(content),
        ],
        100,
      ),
    );
    expect(
      issues.issues.some(
        (issue) => issue.code === "REFERENCE_VERSION_OR_OWNER_MISMATCH",
      ),
    ).toBe(true);
    expect(
      issues.issues.some(
        (issue) => issue.code === "QUESTION_FRAME_ORDER_OR_REFERENCE",
      ),
    ).toBe(true);
    expect(
      issues.issues.some(
        (issue) => issue.code === "PRESENTATION_REFERENCE_MISMATCH",
      ),
    ).toBe(true);
  });
  it("snapshots content, assets, limits and selection before source awaits", async () => {
    const value = makeInput(
      structuredClone(v1.content),
      v1.assets.map((asset) => ({ ...asset, bytes: Buffer.from(asset.bytes) })),
    );
    const building = buildSupportedQuizPack(value, context, expected);
    (value.content as typeof v1.content).product.productId = "mutated";
    value.assets[0]!.bytes.fill(0);
    const built = await building;
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.value.archive).toEqual(archive);
    const limits = { questions: 2 };
    const selection = {
      kind: "expected-version" as const,
      expectedContentVersion: expected as ContentSchemaVersion,
    };
    let resume!: () => void;
    const wait = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const checking = validateSupportedQuizPackCore(
      (async function* () {
        await wait;
        yield archive;
      })(),
      { ...context, limits },
      {
        ...execution(),
        execute: (work) =>
          work(new AbortController().signal, { ...PACK_LIMITS, questions: 2 }),
      },
      selection,
    );
    limits.questions = 1;
    selection.expectedContentVersion = "quizpack-content.v2";
    resume();
    expect((await checking).candidateValid).toBe(true);
  });
  it("enforces lowered limits, cancellation and finite source failure reports", async () => {
    for (const limits of [
      { contentBytes: 1 },
      { manifestBytes: 1 },
      { archiveBytes: 1 },
      { questions: 1 },
      { imagePixels: 1 },
      { resourceBytes: 1 },
      { archiveBytes: PACK_LIMITS.archiveBytes + 1 },
    ]) {
      expect(
        (
          await validateSupportedQuizPack(
            source(archive),
            { ...context, limits },
            expected,
          )
        ).candidateValid,
      ).toBe(false);
    }
    const controller = new AbortController();
    controller.abort();
    expect(
      (
        await validateSupportedQuizPack(
          source(archive),
          { ...context, signal: controller.signal },
          expected,
        )
      ).issues[0]?.code,
    ).toBe("OPERATION_CANCELLED");
    const failed = await validateSupportedQuizPack(
      (async function* () {
        throw new Error("/private/credential");
        yield archive;
      })(),
      context,
      expected,
    );
    expect(failed.candidateValid).toBe(false);
    expect(JSON.stringify(failed)).not.toContain("credential");
  });
  it("retains upstream and final truncation without exposing the control marker", async () => {
    const sentinel = {
      code: "ISSUES_TRUNCATED",
      path: [],
      message: "Additional content issues were omitted.",
    };
    expect(collectIssues([sentinel], 100)).toEqual({
      issues: [],
      issuesTruncated: true,
    });
    expect(collectIssues([], 100, true).issuesTruncated).toBe(true);
    const invalid = await repack((_manifest, content) => {
      for (const question of content.questions)
        for (const option of question.options) option.label = "";
      Object.values(content.layouts).forEach((layout) => {
        layout.component = { id: "", version: "", propsSchemaVersion: "" };
      });
      content.resources.forEach((resource) => {
        resource.width = 0;
        resource.height = 0;
        resource.bytes = 0;
        resource.sha256 = "bad";
      });
    });
    const report = await validateSupportedQuizPack(
      source(invalid),
      context,
      expected,
    );
    expect(report.issuesTruncated).toBe(true);
    expect(report.issues.length).toBeLessThan(100);
    expect(
      report.issues.some((issue) => issue.code === "ISSUES_TRUNCATED"),
    ).toBe(false);
    expect(report.candidateValid).toBe(false);
    const contents = await readRestrictedZip(source(invalid), context);
    if (!contents.ok) throw new Error("fixture");
    const buildFailure = await buildSupportedQuizPack(
      makeInput(
        JSON.parse(contents.value.files.get("content.json")!.toString()),
      ),
      context,
      expected,
    );
    expect(buildFailure).toMatchObject({ ok: false, issuesTruncated: true });
    if (!buildFailure.ok)
      expect(
        buildFailure.issues.some((issue) => issue.code === "ISSUES_TRUNCATED"),
      ).toBe(false);
    const mediaReport = await validateSupportedQuizPackCore(
      source(archive),
      context,
      {
        ...execution(),
        inspect: async () => ({ ok: false, issues: [sentinel] }),
      },
      { kind: "backend-matrix" },
    );
    expect(mediaReport).toMatchObject({
      issues: [],
      issuesTruncated: true,
      candidateValid: false,
    });
    const zipReport = await validateSupportedQuizPackCore(
      source(archive),
      context,
      {
        ...execution(),
        readZip: async () => ({ ok: false, issues: [sentinel] }),
      },
      { kind: "backend-matrix" },
    );
    expect(zipReport).toMatchObject({
      issues: [],
      issuesTruncated: true,
      candidateValid: false,
    });
    const lowered = await validateSupportedQuizPack(
      source(invalid),
      { ...context, limits: { issues: 1 } },
      expected,
    );
    expect(lowered.issues).toHaveLength(1);
    expect(lowered.issuesTruncated).toBe(true);
  });
  it("rejects arbitrary compatibility policy and context accessors before hooks/source", async () => {
    const getter = vi.fn(),
      read = vi.fn(execution().readZip),
      stream = vi.fn(() => source(archive));
    for (const extra of [{ compatibilityPolicy: {} }, { unknown: true }]) {
      const report = await validateSupportedQuizPackCore(
        (async function* () {
          stream();
          yield archive;
        })(),
        { ...context, ...extra } as SupportedValidationContext,
        { ...execution(), readZip: read },
        { kind: "backend-matrix" },
      );
      expect(report.candidateValid).toBe(false);
    }
    expect(read).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    const bad = Object.defineProperty({ ...context }, "compatibilityPolicy", {
      enumerable: true,
      get: getter,
    });
    expect(
      (await validateSupportedQuizPack(source(archive), bad, expected))
        .candidateValid,
    ).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(
      (
        await buildSupportedQuizPack(
          makeInput(v1.content),
          { ...context, compatibilityPolicy: {} } as SupportedValidationContext,
          expected,
        )
      ).ok,
    ).toBe(false);
  });
  it("preserves callback timing and media-before-reference issue ordering", async () => {
    const changed = await repack((_manifest, content) => {
      content.results[0]!.portraitRef.version = "9.0.0";
    });
    const events: string[] = [];
    const mediaIssue: PackIssue = {
      code: "MEDIA_DECODE_FAILED",
      path: [],
      message: "QuizPack operation rejected.",
    };
    const report = await validateSupportedQuizPackCore(
      source(changed),
      context,
      {
        ...execution(events),
        inspect: async () => {
          events.push("inspect");
          return { ok: false, issues: [mediaIssue] };
        },
        parsed: () => {
          events.push("parsed");
        },
      },
      { kind: "backend-matrix" },
    );
    expect(events).toEqual([
      "structure",
      ...v1.assets.map(() => "inspect"),
      "parsed",
    ]);
    expect(
      report.issues
        .slice(0, v1.assets.length)
        .every((issue) => issue.code === mediaIssue.code),
    ).toBe(true);
    const oldEvents: string[] = [];
    const oldExecution: P1CoreExecution = {
      ...execution(oldEvents),
      readZip: readRestrictedZip,
      propagate: () => false,
      parsed: () => {
        oldEvents.push("parsed");
      },
    };
    await validateQuizPackCore(source(archive), context, oldExecution);
    expect(oldEvents).toEqual(events);
    const propagate = vi.fn<SupportedCoreExecution["propagate"]>(() => true);
    await expect(
      validateSupportedQuizPackCore(
        source(archive),
        context,
        {
          ...execution(),
          beforeStructure: () => {
            throw new Error("private");
          },
          propagate,
        },
        { kind: "backend-matrix" },
      ),
    ).rejects.toThrow("private");
    expect(propagate.mock.calls[0]?.[2]).toBe("structure");
  });
});
