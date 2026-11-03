import { qianzaiSupportedThemes } from "./supported-themes";
import { qianzaiPresentationSourceMatches } from "./presentation-source";
import type { ComposedReportBodyV1 as Body } from "@/lib/assessment-contract/composed-report-v1";
import type { ConsumerRendererIdentity } from "@/lib/consumer-contract/v1/identities";
import type { PersistedReportDisplayV2 } from "@/features/report/persisted/view-contracts-v2";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import {
  QIANZAI_PRESENTATION_V11,
  QIANZAI_ROLE_PROFILES_V11,
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
    binding.renderer.version !== "1.4.0" ||
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
    !qianzaiPresentationSourceMatches(d.canonicalContentSha256) ||
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
  // Reveal, poster, tags and the six-volume document use the same supported topics.
  // A single-question fact never outranks these complete multi-context supports.
  const themes = qianzaiSupportedThemes(body);
  const core = themes.slice(0, 2);
  const lines = Object.freeze(
    core[0]
      ? [
          core[0].feature.short[0],
          core[1]?.feature.short[0] ?? core[0].feature.short[1],
          role.invitation,
        ]
      : [...role.baseLines, role.invitation],
  );
  const supportingClaimRefs = Object.freeze(
    core.map(({ snapshot }) => Object.freeze({ ...snapshot.claimRef! })),
  );
  const id = `${role.ref.id}/${core.map(({ feature }) => feature.topic).join("+") || "invitation"}@${QIANZAI_PRESENTATION_V11}`;
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
      tags: Object.freeze(themes.map(({ feature }) => feature.tag)),
    }),
    closure: Object.freeze({
      id,
      lines: Object.freeze([...role.closureLines]),
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
