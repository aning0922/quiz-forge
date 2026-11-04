import type { QianzaiKnownRoleId } from "./known-ten-catalog";
/** Composition plans only; resource facts and private derivative QA live in the delivery manifest.
 * The ten current character directions are accepted for continued making, not commercial use.
 * Reveal/report/poster prefer same-role masters or qualified existing slots; four slots
 * do not require four new scenes. Report-specific crop/padding preserves visible faces
 * above the unchanged exporter mask. Name art stays a separate transparent 5:7 diagonal
 * group at the original anchor; the prefix and seal do not move with name length.
 * Final font coverage, source admission and integrated renderer acceptance belong to integration. */
export const QIANZAI_KNOWN_ROLE_ART_PLAN = [
  {
    id: "li-bai",
    costume: "蓝白流动宽袍与细密织纹，成年俊逸；沿用本批已认可临江举酒面孔",
    revealAction:
      "临江大半身举酒盏，另一手持酒壶，睁眼随举杯远望，唇口带将吟诵的活气，不露脚",
    reportAction: "同角色当前母图报告取景复用；保全面孔，不新增独立场景",
    posterAction: "同角色当前母图海报取景复用，保持原程序纸景、姓名与版式",
    boundary:
      "举杯诗兴为文学艺术意象，非史实肖像；旧烘焙原件保持，衍生内部图检不代替发布资格",
  },
  {
    id: "su-shi",
    costume: "靛蓝银灰暖白厚锦袍，云/几何边纹，成熟俊朗与精心短须",
    revealAction:
      "雨后竹径近正面持竹杖，头端正平视含笑、另一手拢袖，以大半身表现前行意向，不露脚",
    reportAction: "沿用同方向持杖含笑补图作报告取景，不声称是另一独立动作",
    posterAction: "同角色当前母图海报取景复用，保持原程序纸景、姓名与版式",
    boundary:
      "雨杖借词作、具体行走艺术化；保留578×1252原取景，生成细节补图实际852×1846，非原像素等同或1024宽证明",
  },
  {
    id: "tang-yin",
    costume: "墨绿/赭金明风宽袍，竹石线纹，简洁发冠，不套松鹤衣",
    revealAction:
      "大半身前倾侧俯审视山水画，视线沿笔锋落画，执笔手提腕收笔、另一手压纸，不盯镜头，不露脚",
    reportAction: "同审画母图报告专用取景与透明留白，保全面孔和俯视方向",
    posterAction: "同角色当前母图海报取景复用，保持原程序纸景、姓名与版式",
    boundary: "真实绘画身份，具体运笔不复原名作；不点秋香",
  },
  {
    id: "zhou-yu",
    costume:
      "红黑将领锦袍、轻甲护肩与风中披风，利落叠襟；近正面平视，凝定自信有清贵锐气",
    revealAction:
      "楼船船首大半身挺立，一手按腰侧佩剑剑柄、一手扶船栏，背后船阵帆旗，不再琴师回望，不露脚",
    reportAction: "同角色当前母图报告取景复用；保全面孔，不新增独立场景",
    posterAction: "同角色当前母图海报取景复用，保持原程序纸景、姓名与版式",
    boundary:
      "水军统帅身份据本传，船首姿态艺术化；琴不再主动作，不用白羽扇，不演义嫉妒",
  },
  {
    id: "zhao-yun",
    costume: "银灰冷青衣甲、实丝深色内层；较宽成年下颌、直眉沉稳表情，束发利落",
    revealAction: "银甲蓝披风，马旁大半身持银枪，面孔与握枪关系沿用已认可v4",
    reportAction: "已认可v4银枪母图报告取景复用，保全面孔，不重画动作",
    posterAction:
      "已认可v4母图海报专用缩放、留白与局部边缘透明化，保留白马头和银枪刃可辨",
    boundary: "将领身份；马甲颜色与兵器为艺术造型，不神枪七进七出",
  },
  {
    id: "li-qingzhao",
    costume: "青白层叠细花纱衣，独立珠玉与花簪，保留已认可面孔",
    revealAction: "沿用已认可月夜临水持卷原图，青白衣与面孔保持",
    reportAction: "优先复用同角色已合格报告槽位原字节，保持现有面孔与浅底羽化",
    posterAction: "优先复用同角色已合格海报槽位原字节，保持已认可面孔和衣饰",
    boundary: "词作与金石阅读入口，具体手势艺术化",
  },
  {
    id: "yang-yuhuan",
    costume: "石榴红藕金暖白厚丝唐风裙，团花/宝相纹与独立金簪；丰润成年",
    revealAction:
      "自然丰润的大半身展袖收帛，双手与披帛接触清楚，头立颈肩、胸腰少扭转后仰，不露脚、不以落地长裙证明比例",
    reportAction:
      "同母图报告专用取景与透明留白，避免原程序羽化纸景擦到嘴和下巴",
    posterAction: "同角色当前母图海报取景复用，保持原程序纸景、姓名与版式",
    boundary:
      "歌舞音律据史传，收帛姿态艺术化，非霓裳复原；仅审可见比例，不把不可见下肢记为通过，不祸水",
  },
  {
    id: "wu-zetian",
    costume: "深绛紫金暖白厚锦，庄重唐周宫廷轮廓，结构化领袖与独立冠髻",
    revealAction: "御案侧坐展奏牍，抬眼听奏，一手落案缘",
    reportAction: "已认可御案母图报告取景复用，保留成年面孔，不另造书斋动作",
    posterAction: "已认可御案母图海报取景复用，继续原程序纸景和姓名布局",
    boundary: "文史政事身份，不伪造诏令，不把暴力权术作用户优点",
  },
  {
    id: "wang-zhaojun",
    costume: "黛青绛红厚丝披风、暖白内层，简洁汉风发饰，远行轮廓",
    revealAction: "驻马拢披风，一手扶鞍，回望关山",
    reportAction: "已认可关山驻马母图报告取景复用，面部清楚，不另造驿舍场景",
    posterAction: "已认可关山驻马母图海报取景复用，保持披风与远行识别",
    boundary: "出塞史实，具体动作艺术化；无琵琶高手/主动志愿断言",
  },
  {
    id: "cai-wenji",
    costume:
      "雾蓝月白汉风密实交领裙，银丝芦草/兰叶与细枝疏花，柔韧丝缎层次，整洁发髻与朴雅玉簪",
    revealAction:
      "大半身近正面略俯核对旧卷，目光明确落卷，一手持待核卷页、另一手停笔，平静思索而不侧歪讨镜头，不露脚",
    reportAction: "同核卷母图报告专用取景与透明留白，避免羽化遮住口鼻",
    posterAction: "同角色当前母图海报取景复用，保持原程序纸景、姓名与版式",
    boundary: "才学音律与缮书据史传，不断胡笳归属，不投射苦难",
  },
] as const satisfies readonly {
  id: QianzaiKnownRoleId;
  costume: string;
  revealAction: string;
  reportAction: string;
  posterAction: string;
  boundary: string;
}[];
