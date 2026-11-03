import {
  qianzaiTenRoleRef,
  qianzaiTenRoleArtRefs,
  type QianzaiTenRoleRosterEntry,
} from "./ten-role-contract";
/** Reviewed ten-role proposal. Bytes, approvals and renderer identity come from the final new source, never this roster. */
export const QIANZAI_TEN_ROLE_ROSTER = [
  {
    id: "li-bai",
    ref: qianzaiTenRoleRef("li-bai"),
    displayName: "李白",
    sex: "male",
    identityBasis: "documented-historical",
    kind: "documented-historical",
    designTargets: [84, 88, 52, 66, 53],
    primarySources: [
      {
        title: "李白《庐山谣》",
        url: "https://zh.wikisource.org/wiki/廬山謠寄盧侍御虛舟",
      },
    ],
    resourceRefs: qianzaiTenRoleArtRefs("li-bai"),
  },
  {
    id: "su-shi",
    ref: qianzaiTenRoleRef("su-shi"),
    displayName: "苏轼",
    sex: "male",
    identityBasis: "documented-historical",
    kind: "documented-historical",
    designTargets: [68, 58, 60, 48, 78],
    primarySources: [
      {
        title: "苏轼《定风波》",
        url: "https://zh.wikisource.org/wiki/定風波_(莫聽穿林打葉聲)",
      },
    ],
    resourceRefs: qianzaiTenRoleArtRefs("su-shi"),
  },
  {
    id: "wang-wei",
    ref: qianzaiTenRoleRef("wang-wei"),
    displayName: "王维",
    sex: "male",
    identityBasis: "documented-historical",
    kind: "documented-historical",
    designTargets: [42, 30, 60, 28, 34],
    primarySources: [
      {
        title: "王维《山居秋暝》",
        url: "https://zh.wikisource.org/wiki/山居秋暝",
      },
    ],
    resourceRefs: qianzaiTenRoleArtRefs("wang-wei"),
  },
  {
    id: "sun-wukong",
    ref: qianzaiTenRoleRef("sun-wukong"),
    displayName: "孙悟空",
    sex: "male",
    identityBasis: "novel-original",
    kind: "literary-legendary",
    designTargets: [92, 90, 30, 92, 88],
    primarySources: [
      {
        title: "《西游记》第一、十四回",
        url: "https://zh.wikisource.org/wiki/西遊記/第001回",
      },
    ],
    resourceRefs: qianzaiTenRoleArtRefs("sun-wukong"),
  },
  {
    id: "jia-baoyu",
    ref: qianzaiTenRoleRef("jia-baoyu"),
    displayName: "贾宝玉",
    sex: "male",
    identityBasis: "novel-original",
    kind: "literary-legendary",
    designTargets: [35, 64, 88, 42, 50],
    primarySources: [
      {
        title: "《红楼梦》第三回等",
        url: "https://zh.wikisource.org/wiki/紅樓夢/第003回",
      },
    ],
    resourceRefs: qianzaiTenRoleArtRefs("jia-baoyu"),
  },
  {
    id: "li-qingzhao",
    ref: qianzaiTenRoleRef("li-qingzhao"),
    displayName: "李清照",
    sex: "female",
    identityBasis: "documented-historical",
    kind: "documented-historical",
    designTargets: [75, 47, 80, 46, 51],
    primarySources: [
      {
        title: "李清照《渔家傲》",
        url: "https://zh.wikisource.org/wiki/漁家傲_(李清照)",
      },
    ],
    resourceRefs: qianzaiTenRoleArtRefs("li-qingzhao"),
  },
  {
    id: "mulan-ballad",
    ref: qianzaiTenRoleRef("mulan-ballad"),
    displayName: "木兰",
    sex: "female",
    identityBasis: "literary-legend",
    kind: "literary-legendary",
    designTargets: [68, 42, 62, 84, 62],
    primarySources: [
      { title: "佚名《木兰诗》", url: "https://zh.wikisource.org/wiki/木蘭辭" },
    ],
    resourceRefs: qianzaiTenRoleArtRefs("mulan-ballad"),
  },
  {
    id: "xue-tao",
    ref: qianzaiTenRoleRef("xue-tao"),
    displayName: "薛涛",
    sex: "female",
    identityBasis: "documented-historical",
    kind: "documented-historical",
    designTargets: [43, 60, 74, 55, 55],
    primarySources: [
      {
        title: "《全唐诗》卷803",
        url: "https://zh.wikisource.org/wiki/全唐詩/卷803",
      },
    ],
    resourceRefs: qianzaiTenRoleArtRefs("xue-tao"),
  },
  {
    id: "xie-daoyun",
    ref: qianzaiTenRoleRef("xie-daoyun"),
    displayName: "谢道韫",
    sex: "female",
    identityBasis: "documented-historical",
    kind: "documented-historical",
    designTargets: [88, 83, 54, 42, 68],
    primarySources: [
      {
        title: "《晋书》卷96及《世说新语》",
        url: "https://zh.wikisource.org/wiki/晉書/卷096",
      },
    ],
    resourceRefs: qianzaiTenRoleArtRefs("xie-daoyun"),
  },
  {
    id: "xue-baochai",
    ref: qianzaiTenRoleRef("xue-baochai"),
    displayName: "薛宝钗",
    sex: "female",
    identityBasis: "novel-original",
    kind: "literary-legendary",
    designTargets: [35, 28, 42, 22, 48],
    primarySources: [
      {
        title: "《红楼梦》第三十七回等",
        url: "https://zh.wikisource.org/wiki/紅樓夢/第037回",
      },
    ],
    resourceRefs: qianzaiTenRoleArtRefs("xue-baochai"),
  },
] as const satisfies readonly QianzaiTenRoleRosterEntry[];
