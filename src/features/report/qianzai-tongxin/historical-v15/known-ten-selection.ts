import { QIANZAI_KNOWN_TEN_ROLES } from "./known-ten-catalog";

type Ref = Readonly<{ productId: string; id: string; version: string }>;
/** Static catalogue selection only. Neither matching completion nor source,
 * renderer, resource approval or editorial availability is granted here. */
export function qianzaiKnownCatalogRole(ref: Ref) {
  return QIANZAI_KNOWN_TEN_ROLES.find(
    (role) =>
      role.ref.productId === ref.productId &&
      role.ref.id === ref.id &&
      role.ref.version === ref.version,
  );
}

/** UI options derive from the same compiled version list as the score adapter.
 * The server still enforces its own matching policy and exact source binding. */
export function qianzaiKnownCatalogOptions(
  preference: "male" | "female" | "any",
) {
  return QIANZAI_KNOWN_TEN_ROLES.filter(
    (role) => preference === "any" || role.sex === preference,
  );
}
