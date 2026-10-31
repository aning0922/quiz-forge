import type { ComposedReportBodyV1 as Body } from "@/lib/assessment-contract/composed-report-v1";
import type { ConsumerRendererIdentity } from "@/lib/consumer-contract/v1/identities";
import type { PersistedReportDisplayV2 } from "@/features/report/persisted/view-contracts-v2";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import {
  QIANZAI_PRESENTATION_V11,
  QIANZAI_ROLE_PROFILES_V11,
  QIANZAI_V11_CONTENT_SHA256,
  type QianzaiRoleProfileV11,
} from "./role-profiles-v11";

/** Supplied by the trusted implementation resolver, never deserialized from HTTP.
 * The exact installed entry hash is injected after closure collection, avoiding a self-hash import. */
export type QianzaiPresentationBinding = Readonly<{
  renderer: ConsumerRendererIdentity;
  profileVersion: typeof QIANZAI_PRESENTATION_V11;
}>;
type Ref = Body["matching"]["selected"]["ref"];
export type QianzaiResultPresentation = Readonly<{
  kind: "sealed-context-derived";
  profileVersion: typeof QIANZAI_PRESENTATION_V11;
  contentStatus: "experience-candidate";
  body: Body;
  source: Readonly<{
    renderer: ConsumerRendererIdentity;
    bodySha256: string;
    inputHash: string;
    answersHash: string;
    matchingContextSha256: string;
    canonicalContentSha256: string;
  }>;
  role: QianzaiRoleProfileV11;
  quote: QianzaiRoleProfileV11["quotes"][number];
  reveal: Readonly<{
    id: string;
    lines: readonly string[];
    supportingClaimRefs: readonly Ref[];
  }>;
  poster: Readonly<{
    tagline: string;
    lines: readonly string[];
    tags: readonly string[];
  }>;
  closure: Readonly<{ id: string; lines: readonly string[] }>;
}>;
const sameRef = (a: Ref, b: Ref) =>
  a.productId === b.productId && a.id === b.id && a.version === b.version;
const sha = (s: string) => /^[a-f0-9]{64}$/.test(s);
const evidenceRef = (question: string, option: string) => ({
  question,
  option,
});
const supported = (
  body: Body,
  id: string,
  kind: "fact" | "context",
  evidence: readonly ReturnType<typeof evidenceRef>[],
  counter: readonly ReturnType<typeof evidenceRef>[] = [],
) => {
  const expected = { productId: "qianzai-tongxin", id, version: "1.0.0" };
  const matches = (
    actual: Body["volumes"][number]["paragraphs"][number]["evidence"],
    required: typeof evidence,
  ) =>
    actual.length === required.length &&
    required.every((r) =>
      actual.some(
        (e) =>
          sameRef(e.questionRef, { ...expected, id: r.question }) &&
          sameRef(e.optionRef, { ...expected, id: r.option }) &&
          body.answers.some(
            (a) =>
              sameRef(a.questionRef, e.questionRef) &&
              sameRef(a.optionRef, e.optionRef),
          ),
      ),
    );
  return (
    body.volumes
      .flatMap((v) => v.paragraphs)
      .find(
        (p) =>
          p.status === "accepted" &&
          p.kind === kind &&
          p.claimRef &&
          sameRef(p.claimRef, expected) &&
          matches(p.evidence, evidence) &&
          matches(p.counterevidence, counter),
      )?.claimRef ?? null
  );
};
/** Stable decoration index, not a score or a security digest. Uses only canonical sealed identity strings. */
function stableIndex(seed: string, count: number): number {
  let value = 2166136261;
  for (const ch of seed)
    value = Math.imul(value ^ ch.charCodeAt(0), 16777619) >>> 0;
  return value % count;
}
/** Precondition: the caller owns a verified immutable report view. This pure projection
 * cannot grant completion or resource authority. Historical/unknown identities fail closed. */
export function deriveQianzaiResultPresentation(
  view: PersistedReportDisplayV2,
  binding?: QianzaiPresentationBinding,
): QianzaiResultPresentation | null {
  if (
    !binding ||
    binding.profileVersion !== QIANZAI_PRESENTATION_V11 ||
    binding.renderer.kind !== "consumer-renderer" ||
    binding.renderer.id !== "consumer-qianzai-tongxin" ||
    binding.renderer.version !== "1.2.0" ||
    !sameConsumerFact(view.renderer, binding.renderer, 8192)
  )
    return null;
  const d = view.display,
    body = d.body,
    p = body.provenance;
  if (
    ![
      view.renderer.entrySha256,
      d.bodySha256,
      d.inputHash,
      d.answersHash,
      d.matchingContextSha256,
    ].every(sha) ||
    d.canonicalContentSha256 !== QIANZAI_V11_CONTENT_SHA256 ||
    p.canonicalContentSha256 !== d.canonicalContentSha256 ||
    p.inputHash !== d.inputHash ||
    p.answersHash !== d.answersHash ||
    p.matchingContextSha256 !== d.matchingContextSha256 ||
    !sameRef(body.matching.selected.ref, d.selectedResultRef)
  )
    return null;
  const role = QIANZAI_ROLE_PROFILES_V11.find((r) =>
    sameRef(r.ref, body.matching.selected.ref),
  );
  if (!role) return null;
  const quotePool = [...role.quotes].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const seed = JSON.stringify([
    QIANZAI_PRESENTATION_V11,
    view.renderer.kind,
    view.renderer.id,
    view.renderer.version,
    view.renderer.entrySha256,
    role.ref.productId,
    role.ref.id,
    role.ref.version,
    d.bodySha256,
    d.inputHash,
    d.answersHash,
    d.matchingContextSha256,
    "quote",
  ]);
  const quote = quotePool[stableIndex(seed, quotePool.length)]!;
  // Each entry is one complete editorial group. No independent line selection and no score bands.
  const variants = [
    {
      id: "leisure-new-longterm-familiar",
      claim: supported(
        body,
        "authored-407a0f1c9a00adc8d3b5",
        "context",
        [evidenceRef("q02", "q02-b")],
        [evidenceRef("q18", "q18-c")],
      ),
      lines: [
        "闲暇里，你想试试新鲜事，",
        "长远处，你仍愿打磨已有本领。",
        role.invitation,
      ],
      closure: ["愿新鲜与熟悉之间，", "总有安放此刻心意的地方。"],
    },
    {
      id: "leisure-new",
      claim: supported(body, "authored-7053c48e83fe3e6c223d", "fact", [
        evidenceRef("q02", "q02-b"),
      ]),
      lines: [
        "这次闲暇，你想试一件新事，",
        "这一刻的选择，留给新的可能。",
        role.invitation,
      ],
      closure: ["愿这一次小小的尝试，", "为你留下自己的回声。"],
    },
    {
      id: "leisure-familiar",
      claim: supported(body, "authored-929aed7c242fa56709e4", "fact", [
        evidenceRef("q02", "q02-d"),
      ]),
      lines: [
        "这次闲暇，你想精进熟悉技艺，",
        "把这一刻心意，留给已有的热爱。",
        role.invitation,
      ],
      closure: ["愿已有的热爱，", "也能长出新的光。"],
    },
  ] as const;
  const selected = variants.find((v) => v.claim !== null);
  const lines = Object.freeze(
    selected ? [...selected.lines] : [...role.baseLines],
  );
  const supportingClaimRefs = Object.freeze(
    selected?.claim ? [Object.freeze({ ...selected.claim })] : [],
  );
  const id = `${role.ref.id}/${selected?.id ?? "invitation"}@${QIANZAI_PRESENTATION_V11}`;
  return Object.freeze({
    kind: "sealed-context-derived",
    profileVersion: QIANZAI_PRESENTATION_V11,
    contentStatus: "experience-candidate",
    body,
    source: Object.freeze({
      renderer: Object.freeze({ ...view.renderer }),
      bodySha256: d.bodySha256,
      inputHash: d.inputHash,
      answersHash: d.answersHash,
      matchingContextSha256: d.matchingContextSha256,
      canonicalContentSha256: d.canonicalContentSha256,
    }),
    role,
    quote,
    reveal: Object.freeze({ id, lines, supportingClaimRefs }),
    poster: Object.freeze({
      tagline: role.posterTagline,
      lines,
      tags: role.posterTags,
    }),
    closure: Object.freeze({
      id,
      lines: Object.freeze(
        selected ? [...selected.closure] : [...role.closureLines],
      ),
    }),
  });
}
export function qianzaiPresentationMatchesBody(
  body: Body,
  result?: QianzaiResultPresentation,
): result is QianzaiResultPresentation {
  return (
    !!result &&
    (body === result.body || sameConsumerFact(body, result.body, 524288))
  );
}
