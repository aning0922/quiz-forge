import {
  QIANZAI_CLASSICAL_EDITION,
  type QianzaiClassicalRoleProfile,
} from "@/features/report/qianzai-tongxin/historical-v151/classical-edition";
import { qianzaiKnownEditorial } from "@/features/report/qianzai-tongxin/historical-v151/known-ten-editorial";
import {
  qianzaiKnownPresentationSourceMatches,
  QIANZAI_KNOWN_SHARED_TEMPLATE_REF,
} from "@/features/report/qianzai-tongxin/historical-v151/known-presentation-source";
import { qianzaiSupportedThemes } from "@/features/report/qianzai-tongxin/historical-v151/supported-themes";
import { qianzaiPresentationSourceMatches } from "@/features/report/qianzai-tongxin/historical-v151/presentation-source";
import type { ComposedReportBodyV1 as Body } from "@/lib/assessment-contract/composed-report-v1";
import type { ConsumerRendererIdentity } from "@/lib/consumer-contract/v1/identities";
import type { PersistedReportDisplayV2 } from "@/features/report/persisted/view-contracts-v2";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import {
  QIANZAI_PRESENTATION_V11,
  QIANZAI_ROLE_PROFILES_V11,
  type QianzaiRoleProfileV11,
} from "@/features/report/qianzai-tongxin/historical-v151/role-profiles-v11";

/** Supplied by the trusted implementation resolver, never deserialized from HTTP.
 * The exact installed entry hash is injected after closure collection, avoiding a self-hash import. */
export type QianzaiPresentationBinding = Readonly<{
  renderer: ConsumerRendererIdentity;
  profileVersion:
    | typeof QIANZAI_PRESENTATION_V11
    | typeof QIANZAI_CLASSICAL_EDITION.presentationVersion;
  canonicalContentSha256?: string;
}>;
type Ref = Body["matching"]["selected"]["ref"];
export type QianzaiResultPresentation = Readonly<{
  kind: "sealed-context-derived";
  profileVersion:
    | typeof QIANZAI_PRESENTATION_V11
    | typeof QIANZAI_CLASSICAL_EDITION.presentationVersion;
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
  role: QianzaiRoleProfileV11 | QianzaiClassicalRoleProfile;
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
  if (binding?.profileVersion === QIANZAI_CLASSICAL_EDITION.presentationVersion)
    return deriveKnownPresentation(view, binding);
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
  return projectPresentation(view, binding, role);
}
function projectPresentation(
  view: PersistedReportDisplayV2,
  binding: QianzaiPresentationBinding,
  role: QianzaiRoleProfileV11 | QianzaiClassicalRoleProfile,
): QianzaiResultPresentation {
  const d = view.display,
    body = d.body;
  const quotePool = [...role.quotes].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const seed = JSON.stringify([
    binding.profileVersion,
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
  const id = `${role.ref.id}/${core.map(({ feature }) => feature.topic).join("+") || "invitation"}@${binding.profileVersion}`;
  return Object.freeze({
    kind: "sealed-context-derived",
    profileVersion: binding.profileVersion,
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
function deriveKnownPresentation(
  view: PersistedReportDisplayV2,
  binding: QianzaiPresentationBinding,
): QianzaiResultPresentation | null {
  const d = view.display,
    body = d.body,
    p = body.provenance;
  if (
    binding.renderer.kind !== "consumer-renderer" ||
    binding.renderer.id !== "consumer-qianzai-tongxin" ||
    binding.renderer.version !== QIANZAI_CLASSICAL_EDITION.consumerVersion ||
    !sameConsumerFact(view.renderer, binding.renderer, 8192) ||
    !binding.canonicalContentSha256 ||
    !qianzaiKnownPresentationSourceMatches(binding.canonicalContentSha256) ||
    d.contentVersion !== "3.0.0" ||
    d.reportVersion !== "2.0.0" ||
    p.reportVersion !== "2.0.0" ||
    !sameRef(d.reportTemplateRef, QIANZAI_KNOWN_SHARED_TEMPLATE_REF) ||
    !sameRef(p.templateRef, QIANZAI_KNOWN_SHARED_TEMPLATE_REF) ||
    ![
      binding.canonicalContentSha256,
      view.renderer.entrySha256,
      d.bodySha256,
      d.inputHash,
      d.answersHash,
      d.matchingContextSha256,
    ].every(sha) ||
    d.canonicalContentSha256 !== binding.canonicalContentSha256 ||
    p.canonicalContentSha256 !== d.canonicalContentSha256 ||
    p.inputHash !== d.inputHash ||
    p.answersHash !== d.answersHash ||
    p.matchingContextSha256 !== d.matchingContextSha256 ||
    !sameRef(body.matching.selected.ref, d.selectedResultRef)
  )
    return null;
  const data = qianzaiKnownEditorial(body.matching.selected.ref);
  return data ? projectPresentation(view, binding, data.profile) : null;
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
