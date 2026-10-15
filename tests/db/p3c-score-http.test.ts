import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createProductPreviewService } from "@/features/product/preview/service";
import { createProductDraftService } from "@/features/product/drafts/service";
import {
  preparePreviewContent,
  scorePreview,
} from "@/features/theme/preview/projection";
import {
  previewEntryResponseSchema,
  previewRevealResponseSchema,
  type PreviewScope,
  type PreviewBinding,
} from "@/features/product/preview/contracts";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { previewApiPath } from "@/features/product/preview/urls";
import { GET } from "@/app/api/studio/products/[productId]/drafts/[draftId]/revisions/[revision]/preview/route";
import { POST } from "@/app/api/studio/products/[productId]/drafts/[draftId]/revisions/[revision]/preview/score/route";
import { prepareP3cSource } from "./p3c-source-fixture";
import { seedReadyP2b3Source } from "./p2b3-fixture";
import { resetDomainDatabase } from "./p2b2b-domain-fixture";
import {
  openTestDatabase,
  authenticateTestOperator,
  type TestDatabase,
} from "./p2a-fixture";
let db: TestDatabase,
  auth: Awaited<ReturnType<typeof authenticateTestOperator>>,
  readonly: typeof auth;
const service = createProductPreviewService({
  preparePreviewContent,
  scorePreview,
});
type Source = {
  scope: PreviewScope;
  binding: PreviewBinding;
  content: Awaited<
    ReturnType<typeof prepareP3cSource>
  >["candidate"]["facts"]["content"];
};
const sources: Source[] = [];
beforeAll(async () => {
  db = await openTestDatabase();
  await resetDomainDatabase(db);
  auth = await authenticateTestOperator(db);
  readonly = await authenticateTestOperator(db, "read-only");
  for (const engine of ["archetype", "dimensions"] as const) {
    const p = await prepareP3cSource(`score-preview-${randomUUID()}`, engine),
      source = await seedReadyP2b3Source(db, auth, p);
    const draft = await createProductDraftService().applyReadyValidation(
      db.app,
      auth.credentials,
      source.scope,
      source.input,
    );
    const scope = {
      productId: p.productId,
      draftId: draft.application.draftId,
      revision: 1,
    };
    const entry = await service.entry(db.app, readonly.credentials, scope, {
      signal: new AbortController().signal,
      deadlineMonotonicMs: performance.now() + 15000,
    });
    sources.push({
      scope,
      binding: entry.binding,
      content: p.candidate.facts.content,
    });
  }
});
afterAll(async () => {
  if (db) {
    await resetDomainDatabase(db);
    await db.close();
  }
});
const budget = () => ({
  signal: new AbortController().signal,
  deadlineMonotonicMs: performance.now() + 15000,
});
const answers = (s: Source, index = 0) =>
  s.content.results[index]!.witness.answers.map((a) => ({
    questionId: a.questionRef.id,
    optionId: a.optionRef.id,
  }));
async function snapshot() {
  const [r] = await db.admin
    .sql`SELECT (SELECT count(*)::int FROM qf.draft_revision) revisions,(SELECT count(*)::int FROM qf.draft_application) applications,(SELECT count(*)::int FROM qf.audit_event) audit`;
  return r;
}
it.each([0, 1])(
  "actual projection/scoring engine source %i returns selected report only with no DB writes",
  async (index) => {
    const s = sources[index]!,
      before = await snapshot(),
      hashes = new Set<string>();
    for (const [i, result] of s.content.results.entries()) {
      const requestId = randomUUID();
      const reveal = await service.score(
        db.app,
        readonly.credentials,
        s.scope,
        { binding: s.binding, requestId, answers: answers(s, i) },
        budget(),
      );
      expect(reveal.requestId).toBe(requestId);
      expect(reveal.selectedResultRef.id).toBe(result.id);
      expect(reveal.reportTemplateRef).toEqual(result.reportTemplateRef);
      expect(reveal.report.baseline).toEqual(
        s.content.reportTemplates.find(
          (r) => r.id === result.reportTemplateRef.id,
        )!.baseline,
      );
      expect(reveal.result.portrait.resourceRef).toEqual(result.portraitRef);
      expect(reveal.binding).toEqual(s.binding);
      expect(
        previewRevealResponseSchema.safeParse({ ok: true, value: reveal })
          .success,
      ).toBe(true);
      expect(JSON.stringify(reveal)).not.toMatch(
        /normalizedAnswers|contributions|squaredDistance|witnesses/,
      );
      hashes.add(reveal.answersHash);
      const reverse = await service.score(
        db.app,
        readonly.credentials,
        s.scope,
        {
          binding: s.binding,
          requestId: randomUUID(),
          answers: answers(s, i).reverse(),
        },
        budget(),
      );
      expect(reverse.answersHash).toBe(reveal.answersHash);
    }
    expect(hashes.size).toBe(s.content.results.length);
    expect(await snapshot()).toEqual(before);
  },
);
it("actual fixed entry route does not transmit result, portrait, baseline or scoring vectors", async () => {
  const s = sources[0]!,
    req = new Request(db.config.origin + previewApiPath(s.scope), {
      headers: {
        host: new URL(db.config.origin).host,
        cookie: `${SESSION_COOKIE}=${readonly.session.raw}`,
      },
    });
  const response = await GET(req, {
    params: Promise.resolve({ ...s.scope, revision: "1" }),
  });
  expect(response.status).toBe(200);
  const raw = await response.json();
  expect(previewEntryResponseSchema.safeParse(raw).success).toBe(true);
  expect(JSON.stringify(raw)).not.toMatch(
    /portrait|baseline|contributions|witness|"results"|"rules"|"targets"/,
  );
});
it("actual score POST route preserves caller requestId while errors use independent server observation ID", async () => {
  const s = sources[0]!,
    requestId = randomUUID();
  const req = (csrf: string) =>
    new Request(db.config.origin + previewApiPath(s.scope, "score"), {
      method: "POST",
      headers: {
        host: new URL(db.config.origin).host,
        origin: db.config.origin,
        cookie: `${SESSION_COOKIE}=${readonly.session.raw}`,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        binding: s.binding,
        requestId,
        answers: answers(s),
      }),
    });
  const response = await POST(req(readonly.credentials.csrfToken), {
    params: Promise.resolve({ ...s.scope, revision: "1" }),
  });
  expect(response.status).toBe(200);
  const value = await response.json();
  expect(value.value.requestId).toBe(requestId);
  expect(previewRevealResponseSchema.safeParse(value).success).toBe(true);
  const rejected = await POST(req("bad"), {
    params: Promise.resolve({ ...s.scope, revision: "1" }),
  });
  expect(rejected.status).toBe(403);
  const error = await rejected.json();
  expect(error.code).toBe("CSRF_REJECTED");
  expect(error.requestId).not.toBe(requestId);
});
it("actual scorer rejects incomplete, duplicate, foreign and cross-question answers", async () => {
  const s = sources[0]!,
    complete = answers(s);
  const bad = [
    complete.slice(0, -1),
    [...complete, complete[0]!],
    complete.map((a, i) =>
      i === 0 ? { ...a, optionId: "unknown-option" } : a,
    ),
    complete.map((a, i) =>
      i === 0 ? { ...a, optionId: complete[1]!.optionId } : a,
    ),
  ];
  for (const a of bad)
    await expect(
      service.score(
        db.app,
        readonly.credentials,
        s.scope,
        { binding: s.binding, requestId: randomUUID(), answers: a },
        budget(),
      ),
    ).rejects.toMatchObject({ code: "PREVIEW_INVALID_ANSWERS" });
});
it("full renderer/font/hash binding mismatches never score a fallback source", async () => {
  const s = sources[0]!;
  for (const binding of [
    { ...s.binding, revision: 2 },
    { ...s.binding, canonicalContentSha256: "f".repeat(64) },
    { ...s.binding, font: { ...s.binding.font, fileSha256: "f".repeat(64) } },
    { ...s.binding, renderer: { ...s.binding.renderer, version: "99.0.0" } },
  ])
    await expect(
      service.score(
        db.app,
        readonly.credentials,
        s.scope,
        { binding, requestId: randomUUID(), answers: answers(s) },
        budget(),
      ),
    ).rejects.toMatchObject({ code: "PREVIEW_BINDING_MISMATCH" });
});
