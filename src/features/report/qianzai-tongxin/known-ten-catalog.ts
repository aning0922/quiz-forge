/** Author-confirmed roster; data only, no source/renderer/resource approval.
 * Target coordinates are fictional literary-entertainment design: not historical
 * psychological facts, reader abilities, talent or military competence.
 * Order: voice, exploration, care, action, activity-structure preservation/reordering.
 * Reachability/near-neighbour/preference checks remain integration work; no claim
 * of balanced probabilities or final scoring acceptance is made by this catalogue. */
export const QIANZAI_KNOWN_TEN_CATALOG_VERSION =
  "qianzai-known-ten.v1" as const;
export const QIANZAI_KNOWN_ROLE_VERSION = "3.0.0" as const;
export const qianzaiKnownRoleRef = (id: string) => ({
  productId: "qianzai-tongxin" as const,
  id,
  version: QIANZAI_KNOWN_ROLE_VERSION,
});
export const qianzaiKnownRoleArtRefs = (id: string) => ({
  reveal: qianzaiKnownRoleRef(`qztx-known-${id}-reveal`),
  report: qianzaiKnownRoleRef(`qztx-known-${id}-report`),
  poster: qianzaiKnownRoleRef(`qztx-known-${id}-poster`),
  nameArt: qianzaiKnownRoleRef(`qztx-known-${id}-nameart`),
});
export const QIANZAI_KNOWN_TEN_ROLES = (
  [
    {
      id: "li-bai",
      displayName: "李白",
      sex: "male",
      kind: "documented-historical",
      identityBasis: "documented-historical",
      designTargets: [84, 88, 52, 66, 53],
      primarySources: [
        {
          title: "《庐山谣寄卢侍御虚舟》",
          url: "https://zh.wikisource.org/wiki/廬山謠寄盧侍御虛舟",
        },
      ],
    },
    {
      id: "su-shi",
      displayName: "苏轼",
      sex: "male",
      kind: "documented-historical",
      identityBasis: "documented-historical",
      designTargets: [68, 58, 60, 48, 78],
      primarySources: [
        {
          title: "苏轼词作入口",
          url: "https://zh.wikisource.org/wiki/定風波_(莫聽穿林打葉聲)",
        },
      ],
    },
    {
      id: "tang-yin",
      displayName: "唐伯虎",
      alternateNames: ["唐寅"],
      sex: "male",
      kind: "documented-historical",
      identityBasis: "documented-historical",
      designTargets: [76, 78, 54, 55, 66],
      primarySources: [
        {
          title: "国立故宫：唐寅《山路松声》",
          url: "https://digitalarchive.npm.gov.tw/Collection/Detail/3265?dep=P",
        },
      ],
    },
    {
      id: "zhou-yu",
      displayName: "周瑜",
      sex: "male",
      kind: "documented-historical",
      identityBasis: "documented-historical",
      designTargets: [65, 55, 48, 76, 81],
      primarySources: [
        {
          title: "《三国志》卷54",
          url: "https://zh.wikisource.org/wiki/三國志/卷54",
        },
      ],
    },
    {
      id: "zhao-yun",
      displayName: "赵云",
      sex: "male",
      kind: "documented-historical",
      identityBasis: "documented-historical",
      designTargets: [73, 35, 44, 82, 38],
      primarySources: [
        {
          title: "《三国志》卷36",
          url: "https://zh.wikisource.org/wiki/三國志/卷36",
        },
      ],
    },
    {
      id: "li-qingzhao",
      displayName: "李清照",
      sex: "female",
      kind: "documented-historical",
      identityBasis: "documented-historical",
      designTargets: [75, 47, 80, 46, 51],
      primarySources: [
        {
          title: "李清照《如梦令》",
          url: "https://zh.wikisource.org/zh-hans/如夢令_(李清照)/如夢令_(常記溪亭日暮)",
        },
      ],
    },
    {
      id: "yang-yuhuan",
      displayName: "杨玉环",
      sex: "female",
      kind: "documented-historical",
      identityBasis: "documented-historical",
      designTargets: [56, 68, 72, 65, 68],
      primarySources: [
        {
          title: "《旧唐书》卷51",
          url: "https://zh.wikisource.org/wiki/舊唐書/卷51",
        },
      ],
    },
    {
      id: "wu-zetian",
      displayName: "武则天",
      sex: "female",
      kind: "documented-historical",
      identityBasis: "documented-historical",
      designTargets: [89, 59, 26, 80, 84],
      primarySources: [
        {
          title: "《旧唐书》卷6",
          url: "https://zh.wikisource.org/wiki/舊唐書/卷6",
        },
      ],
    },
    {
      id: "wang-zhaojun",
      displayName: "王昭君",
      sex: "female",
      kind: "documented-historical",
      identityBasis: "documented-historical",
      designTargets: [45, 52, 69, 49, 46],
      primarySources: [
        {
          title: "《汉书》卷94下",
          url: "https://zh.wikisource.org/wiki/漢書/卷094下",
        },
      ],
    },
    {
      id: "cai-wenji",
      displayName: "蔡文姬",
      alternateNames: ["蔡琰"],
      sex: "female",
      kind: "documented-historical",
      identityBasis: "documented-historical",
      designTargets: [48, 34, 58, 35, 30],
      primarySources: [
        {
          title: "《后汉书》卷84",
          url: "https://zh.wikisource.org/wiki/後漢書/卷84",
        },
      ],
    },
  ] as const
).map((role) => ({
  ...role,
  ref: qianzaiKnownRoleRef(role.id),
  resourceRefs: qianzaiKnownRoleArtRefs(role.id),
}));
export type QianzaiKnownRoleId = (typeof QIANZAI_KNOWN_TEN_ROLES)[number]["id"];
