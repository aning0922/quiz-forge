import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canonicalOrdinaryJson } from "@/lib/json/canonical";
import {
  IMPLEMENTATION_DESCRIPTORS,
  implementationIdentity,
  findRendererImplementationDescriptor,
  findEngineImplementationDescriptor,
} from "./implementation-catalog";
import {
  resolveEngineImplementation,
  resolveRendererServer,
} from "./implementation-server";
import { resolveRendererClient } from "./implementation-client";
import { verifyInternalImplementations } from "../../../../scripts/verify-internal-implementations";
import { readImplementationLock } from "../../../../scripts/internal-implementation-lock";
import { quizPackContentV2Schema } from "@/features/quizpack/content/v2";
import { prepareContentForScoring } from "@/features/quizpack/content/scoring-adapter";
const hash = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const source = () =>
  readFile(
    new URL(
      "../../../../tests/fixtures/p3e-baseline/content.json",
      import.meta.url,
    ),
    "utf8",
  ).then((text) => quizPackContentV2Schema.parse(JSON.parse(text)));
const rendererIdentity = () =>
  implementationIdentity(IMPLEMENTATION_DESCRIPTORS.renderers[0]!);
const engineIdentity = () =>
  implementationIdentity(IMPLEMENTATION_DESCRIPTORS.engines[0]!);
it("retains the historical renderer facts without execution, and binds the current exact identity", () => {
  const original = {
    kind: "renderer",
    id: "folio-cabinet-preview",
    version: "1.0.0",
    entrySha256:
      "35a1f8c7c6ce06c1afe09d7c3920f50a13a8fbbd674b7b6609890ae7dc1ed4f2",
  };
  expect(findRendererImplementationDescriptor(original)).not.toBeNull();
  expect(resolveRendererClient(original)).toBeNull();
  expect(resolveRendererServer(original)).toBeNull();
  for (const historical of IMPLEMENTATION_DESCRIPTORS.engines.slice(2)) {
    const identity = implementationIdentity(historical);
    expect(findEngineImplementationDescriptor(identity)).not.toBeNull();
    expect(resolveEngineImplementation(identity)).toBeNull();
  }
  const current = rendererIdentity();
  const client = resolveRendererClient(current),
    server = resolveRendererServer(current);
  expect(client).not.toBeNull();
  expect(server).not.toBeNull();
  expect(client?.descriptor).toBe(server?.descriptor);
  expect(client?.descriptor.capability).toBe("studio-internal-preview");
  expect(Object.keys(client!.components)).toEqual([
    "folio-cover",
    "folio-question",
    "folio-resume",
    "cabinet-result",
    "folio-report",
    "folio-poster",
  ]);
  expect(Object.isFrozen(client!.descriptor.font)).toBe(true);
  for (const field of ["entrySha256", "id", "version", "kind"]) {
    const wrong = {
      ...current,
      [field]: field === "entrySha256" ? "0".repeat(64) : "unavailable",
    };
    expect(resolveRendererClient(wrong)).toBeNull();
    expect(resolveRendererServer(wrong)).toBeNull();
  }
});
it("hashes each selected descriptor and implementation closure independently", () => {
  for (const entry of [
    ...IMPLEMENTATION_DESCRIPTORS.renderers,
    ...IMPLEMENTATION_DESCRIPTORS.engines,
  ]) {
    expect(
      hash(
        canonicalOrdinaryJson(entry.descriptor, {
          maxBytes: 131072,
          maxDepth: 32,
        }),
      ),
    ).toBe(entry.entrySha256);
    expect(
      hash(
        canonicalOrdinaryJson(entry.descriptor.closure, {
          maxBytes: 131072,
          maxDepth: 32,
        }),
      ),
    ).toBe(entry.descriptor.implementationSha256);
  }
});
it("the exact engine binds private handles, rejects cross-engine handles and executes real witnesses", async () => {
  const content = await source(),
    engine = resolveEngineImplementation(engineIdentity())!;
  const prepared = engine.prepare(content);
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) throw Error("PREPARE_FAILED");
  const witnesses = engine.witnesses(prepared.value);
  expect(witnesses.ok).toBe(true);
  if (!witnesses.ok) throw Error("WITNESS_FAILED");
  expect(witnesses.value.evidence.logicHash).toBe(
    "97cb6ba14a3f52a47d6834812641d3a790d26833f5889dd94c16037b002ddddf",
  );
  for (const result of content.results) {
    const answer = result.witness.answers.map((a) => ({
      questionId: a.questionRef.id,
      optionId: a.optionRef.id,
    }));
    const scored = engine.score(prepared.value, answer);
    expect(scored.ok).toBe(true);
    if (scored.ok) {
      expect(scored.value.score.decision.selectedResultRef.id).toBe(result.id);
      expect(
        resolveRendererServer(rendererIdentity())!.projectResult(
          content,
          scored.value,
        ).ok,
      ).toBe(true);
    }
  }
  const other = resolveEngineImplementation(
    implementationIdentity(IMPLEMENTATION_DESCRIPTORS.engines[1]!),
  )!;
  expect(other.prepare(content).ok).toBe(false);
  expect(other.witnesses(prepared.value).ok).toBe(false);
  const raw = prepareContentForScoring(content);
  if (!raw.ok) throw Error("FIXTURE");
  expect(engine.witnesses(raw.value as never).ok).toBe(false);
  expect(
    resolveEngineImplementation({
      ...engineIdentity(),
      entrySha256: "0".repeat(64),
    }),
  ).toBeNull();
  expect(findEngineImplementationDescriptor(engineIdentity())).not.toBeNull();
});
it("retains historical descriptors when executable availability is disabled, without fallback", async () => {
  vi.resetModules();
  vi.doMock("./implementation-catalog", async () => {
    const actual = await vi.importActual<
      typeof import("./implementation-catalog")
    >("./implementation-catalog");
    return {
      ...actual,
      rendererImplementationAvailable: () => false,
      engineImplementationAvailable: () => false,
    };
  });
  try {
    const catalog = await import("./implementation-catalog"),
      server = await import("./implementation-server"),
      client = await import("./implementation-client");
    expect(
      catalog.findRendererImplementationDescriptor(rendererIdentity()),
    ).not.toBeNull();
    expect(
      catalog.findEngineImplementationDescriptor(engineIdentity()),
    ).not.toBeNull();
    expect(client.resolveRendererClient(rendererIdentity())).toBeNull();
    expect(server.resolveRendererServer(rendererIdentity())).toBeNull();
    expect(server.resolveEngineImplementation(engineIdentity())).toBeNull();
  } finally {
    vi.doUnmock("./implementation-catalog");
    vi.resetModules();
  }
});
describe("read-only implementation build gate", () => {
  it("verifies actual files, fonts, imports, installed direct versions and selected lock records", async () => {
    const r = await verifyInternalImplementations(process.cwd());
    expect(r.available).toBe(3);
    expect(r.sourceFiles).toBeGreaterThan(45);
  });
  it.each([
    "src/features/theme/preview/components.tsx",
    "src/app/globals.css",
    "public/assets/fonts/preview-v1-1/serif-600.woff2",
    "next.config.ts",
  ])(
    "rejects changed selected input %s without touching the original",
    async (file) => {
      await expect(
        verifyInternalImplementations(process.cwd(), async (p) => {
          const bytes = await readFile(p);
          return p === file
            ? Buffer.concat([bytes, Buffer.from("changed")])
            : bytes;
        }),
      ).rejects.toThrow("IMPLEMENTATION_FILE_CHANGED");
    },
  );
  it("rejects a changed selected dependency and lock setting", async () => {
    for (const [from, to] of [
      ["specifier: 4.6.6", "specifier: 4.6.7"],
      ["autoInstallPeers: true", "autoInstallPeers: false"],
    ])
      await expect(
        verifyInternalImplementations(process.cwd(), async (p) => {
          const b = await readFile(p);
          return p === "pnpm-lock.yaml"
            ? Buffer.from(b.toString("utf8").replace(from!, to!))
            : b;
        }),
      ).rejects.toThrow(
        /IMPLEMENTATION_(ROOT_DEPENDENCY|LOCK_SETTINGS)_CHANGED/,
      );
  });
  it("rejects a changed Node or package manager policy", async () => {
    for (const change of [
      (v: Record<string, unknown>) => {
        v.engines = { node: ">=999" };
      },
      (v: Record<string, unknown>) => {
        v.packageManager = "pnpm@999.0.0";
      },
    ]) {
      await expect(
        verifyInternalImplementations(process.cwd(), async (p) => {
          const b = await readFile(p);
          if (p !== "package.json") return b;
          const v = JSON.parse(b.toString("utf8"));
          change(v);
          return Buffer.from(JSON.stringify(v));
        }),
      ).rejects.toThrow("IMPLEMENTATION_RUNTIME_POLICY_CHANGED");
    }
  });
  it("does not bind unrelated package metadata or new independent lock entries", async () => {
    const result = await verifyInternalImplementations(
      process.cwd(),
      async (p) => {
        const b = await readFile(p);
        if (p === "package.json") {
          const v = JSON.parse(b.toString("utf8"));
          v.description = "unrelated metadata";
          return Buffer.from(JSON.stringify(v));
        }
        if (p === "pnpm-lock.yaml") {
          const text = b
            .toString("utf8")
            .replace(
              "snapshots:\n",
              "  zz-unrelated@1.0.0:\n    resolution: {integrity: unrelated}\n\nsnapshots:\n",
            );
          return Buffer.from(text + "\n  zz-unrelated@1.0.0: {}\n");
        }
        return b;
      },
    );
    expect(result.available).toBe(3);
  });
  it("rejects duplicate or ambiguously quoted selected lock keys and sections", async () => {
    const text = await readFile("pnpm-lock.yaml", "utf8");
    for (const changed of [
      text + "\npackages:\n",
      text + "\n  zod@4.6.6: {}\n",
      text + "\n  'zod@4.6.6': {}\n",
      text + '\n  "zod@4.6.6": {}\n',
      text + '\n"packages":\n',
    ])
      expect(() => readImplementationLock(changed)).toThrow();
  });
});
