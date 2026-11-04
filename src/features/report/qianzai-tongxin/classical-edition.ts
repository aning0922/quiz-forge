import type { ConsumerRendererIdentity } from "@/lib/consumer-contract/v1/identities";
import type { QianzaiRoleProfileV11 } from "./role-profiles-v11";
import type { QianzaiResultPresentation } from "./result-presentation";

/** The ten-role edition is separate from the retained V11 source aliases.
 * These identities grant no availability until the exact closure is registered. */
export const QIANZAI_CLASSICAL_EDITION = Object.freeze({
  consumerVersion: "1.5.2",
  previewVersion: "1.3.0",
  presentationVersion: "qianzai-role-presentation.v2",
  copyVersion: "qianzai-consumer-copy.v3",
} as const);

/** Consumer patch identity is separate from the unchanged sealed preview map. */
export const QIANZAI_CLASSICAL_CONSUMER_RENDERER = Object.freeze({
  id: "consumer-qianzai-tongxin",
  version: QIANZAI_CLASSICAL_EDITION.consumerVersion,
});

/** Static editorial data only. Scores, resource authority and source approval
 * still come from the verified QuizPack/report and the trusted resolver. */
type ProfileFields = Omit<QianzaiRoleProfileV11, "lifespan">;
export type QianzaiClassicalRoleProfile = ProfileFields &
  (
    | Readonly<{
        sourceKind: "documented-historical";
        lifespan?: string;
      }>
    | Readonly<{
        sourceKind: "novel-original" | "literary-legend";
        sourceWork: string;
        lifespan?: never;
      }>
  );

/** Built by the implementation resolver, never accepted from HTTP or B's data.
 * The final source hash must be supplied from the new compiled registration. */
export type QianzaiClassicalPresentationBinding = Readonly<{
  renderer: ConsumerRendererIdentity & {
    id: "consumer-qianzai-tongxin";
    version: typeof QIANZAI_CLASSICAL_EDITION.consumerVersion;
  };
  profileVersion: typeof QIANZAI_CLASSICAL_EDITION.presentationVersion;
  canonicalContentSha256: string;
}>;

export type QianzaiClassicalResultPresentation = Omit<
  QianzaiResultPresentation,
  "profileVersion" | "role" | "quote"
> &
  Readonly<{
    profileVersion: typeof QIANZAI_CLASSICAL_EDITION.presentationVersion;
    role: QianzaiClassicalRoleProfile;
    quote: QianzaiClassicalRoleProfile["quotes"][number];
  }>;

/** Applied only when wiring the new edition; gender tokens and scoring stay. */
export const QIANZAI_CLASSICAL_PREFERENCE_COPY = Object.freeze({
  male: "只匹配男性人物",
  female: "只匹配女性人物",
  any: "不限制人物性别",
  legend: "希望相逢的人物性别，不代表你的性别，不改变五维分数",
});
