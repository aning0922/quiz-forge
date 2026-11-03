import { QIANZAI_CLASSICAL_RETAINED_ROLE_DATA } from "./classical-retained-role-data";
import { QIANZAI_CLASSICAL_POET_ROLE_DATA } from "./classical-poet-role-data";

/** Author correction: only the six completed historical profiles remain here.
 * Novel characters and Mulan are withdrawn from the new edition. The existing
 * V11 source, its Mulan profile and all historical reports remain untouched.
 * Four historical replacements await the new roster review and sourced prose. */
export const QIANZAI_CLASSICAL_ROLE_DATA = [
  ...QIANZAI_CLASSICAL_RETAINED_ROLE_DATA,
  ...QIANZAI_CLASSICAL_POET_ROLE_DATA,
] as const;

/** Fixed display corpus; no URLs, resource identities, answers or session text. */
export function qianzaiClassicalRoleText(): readonly string[] {
  const collect = (value: unknown): string[] =>
    typeof value === "string"
      ? [value]
      : Array.isArray(value)
        ? value.flatMap(collect)
        : value && typeof value === "object"
          ? Object.values(value).flatMap(collect)
          : [];
  return QIANZAI_CLASSICAL_ROLE_DATA.flatMap(({ profile, copy }) =>
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
