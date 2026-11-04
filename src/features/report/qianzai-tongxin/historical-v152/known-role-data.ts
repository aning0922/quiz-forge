import { QIANZAI_KNOWN_TEN_ROLES } from "@/features/report/qianzai-tongxin/historical-v152/known-ten-catalog";
import { QIANZAI_KNOWN_RETAINED_ROLE_DATA } from "@/features/report/qianzai-tongxin/historical-v152/known-retained-role-data";
import { QIANZAI_KNOWN_NEW_ROLE_DATA } from "@/features/report/qianzai-tongxin/historical-v152/known-new-role-data";
const completed = [
  ...QIANZAI_KNOWN_RETAINED_ROLE_DATA,
  ...QIANZAI_KNOWN_NEW_ROLE_DATA,
];
/** Exact current catalogue order; no withdrawn role is included or registered.
 * Integration owns the version/source/renderer binding and preserves old snapshots. */
export const QIANZAI_KNOWN_ROLE_DATA = QIANZAI_KNOWN_TEN_ROLES.map((role) => {
  const data = completed.find((data) => data.profile.ref.id === role.id);
  if (!data) throw new Error("QIANZAI_KNOWN_EDITORIAL_MISSING");
  return data;
});
/** Full fixed display corpus. Metadata refs, URLs and private answers excluded. */
export function qianzaiKnownRoleText(): readonly string[] {
  const collect = (v: unknown): string[] =>
    typeof v === "string"
      ? [v]
      : Array.isArray(v)
        ? v.flatMap(collect)
        : v && typeof v === "object"
          ? Object.values(v).flatMap(collect)
          : [];
  return QIANZAI_KNOWN_ROLE_DATA.flatMap(({ profile, copy }) =>
    collect({
      ...profile,
      ref: undefined,
      sourceKind: undefined,
      quotes: profile.quotes.map(({ text, source }) => ({ text, source })),
      ...copy,
      historySources: copy.historySources.map(({ label }) => label),
    }),
  );
}
