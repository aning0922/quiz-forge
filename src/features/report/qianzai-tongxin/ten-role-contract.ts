/** Compiled editorial data only. Neither a role label nor a resource selector
 * grants source/renderer/asset authority. Integration owns those exact bindings. */
export const QIANZAI_TEN_ROLE_DATA_VERSION =
  "qianzai-ten-role-data.v1" as const;
export const QIANZAI_TEN_ROLE_IDS = [
  "li-bai",
  "su-shi",
  "wang-wei",
  "sun-wukong",
  "jia-baoyu",
  "li-qingzhao",
  "mulan-ballad",
  "xue-tao",
  "xie-daoyun",
  "xue-baochai",
] as const;
export type QianzaiTenRoleId = (typeof QIANZAI_TEN_ROLE_IDS)[number];
export type QianzaiTenRoleRef = Readonly<{
  productId: "qianzai-tongxin";
  id: string;
  version: "2.0.0";
}>;
export const qianzaiTenRoleRef = (id: string): QianzaiTenRoleRef => ({
  productId: "qianzai-tongxin",
  id,
  version: "2.0.0",
});
export const qianzaiTenRoleArtRefs = (id: QianzaiTenRoleId) => ({
  reveal: qianzaiTenRoleRef(`qztx-ten-${id}-reveal`),
  report: qianzaiTenRoleRef(`qztx-ten-${id}-report`),
  poster: qianzaiTenRoleRef(`qztx-ten-${id}-poster`),
  nameArt: qianzaiTenRoleRef(`qztx-ten-${id}-nameart`),
});
export type QianzaiTenRoleIdentityBasis =
  "documented-historical" | "novel-original" | "literary-legend";
export type QianzaiTenRoleRosterEntry = Readonly<{
  id: QianzaiTenRoleId;
  ref: QianzaiTenRoleRef;
  displayName: string;
  sex: "male" | "female";
  identityBasis: QianzaiTenRoleIdentityBasis;
  kind: "documented-historical" | "literary-legendary";
  /** Editorial design coordinates, never historical psychological measurements. */
  designTargets: readonly [number, number, number, number, number];
  primarySources: readonly Readonly<{ title: string; url: string }>[];
  resourceRefs: ReturnType<typeof qianzaiTenRoleArtRefs>;
}>;
