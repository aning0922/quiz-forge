import { QIANZAI_KNOWN_ROLE_DATA } from "@/features/report/qianzai-tongxin/historical-v152/known-role-data";
import { qianzaiKnownCatalogRole } from "@/features/report/qianzai-tongxin/historical-v152/known-ten-selection";

type Ref = Readonly<{ productId: string; id: string; version: string }>;
const sameRef = (a: Ref, b: Ref) =>
  a.productId === b.productId && a.id === b.id && a.version === b.version;

/** Static, exact editorial selection for the new version. This is not a source,
 * renderer or resource approval and cannot replace a sealed report's identity. */
export function qianzaiKnownEditorial(ref: Ref) {
  const role = qianzaiKnownCatalogRole(ref);
  if (!role) return undefined;
  const candidates = QIANZAI_KNOWN_ROLE_DATA.filter((data) =>
    sameRef(data.profile.ref, role.ref),
  );
  if (candidates.length !== 1) return undefined;
  const data = candidates[0]!;
  if (
    data.profile.displayName !== role.displayName ||
    data.profile.sourceKind !== "documented-historical" ||
    !data.profile.quotes.length ||
    data.profile.quotes.some(
      (q) => !q.id || !q.text || !q.source || !q.sourceUrl,
    ) ||
    new Set(data.profile.quotes.map((q) => q.id)).size !==
      data.profile.quotes.length ||
    !Object.entries(role.resourceRefs).every(([slot, expected]) =>
      sameRef(
        data.resourceRefs[slot as keyof typeof data.resourceRefs],
        expected,
      ),
    )
  )
    return undefined;
  return data;
}
