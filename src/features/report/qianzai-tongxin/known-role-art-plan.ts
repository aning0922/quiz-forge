import type { QianzaiKnownRoleId } from "./known-ten-catalog";
/** Composition plans only, not generated art, author visual acceptance or resource hashes.
 * Name art remains a separate 5:7 diagonal, optically centered group at the original
 * lower anchor; neither the prefix nor seal is moved to compensate for name length.
 * The six revised reveal compositions are half-body candidates, with no feet shown.
 * Report/poster work is paused for those six; in-flight name art stays pending.
 * Internal direction review is not author approval, final-resolution proof or admission. */
export const QIANZAI_KNOWN_ROLE_ART_PLAN = [
  {
    id: "li-bai",
    costume: "蓝白流动宽袍与细密织纹，成年俊逸；新版面孔候选不沿用旧图批准",
    revealAction:
      "临江大半身举酒盏，另一手持酒壶，睁眼随举杯远望，唇口带将吟诵的活气，不露脚",
    reportAction: "暂停用途派生；新版揭晓候选复看后再定独立报告构图",
    posterAction: "暂停用途派生；新版揭晓候选复看后再定独立海报构图",
    boundary:
      "举杯诗兴为文学艺术意象，非史实肖像；旧烘焙原件保持，新批次候选待作者复看",
  },
  {
    id: "su-shi",
    costume: "靛蓝银灰暖白厚锦袍，云/几何边纹，成熟俊朗与精心短须",
    revealAction:
      "雨后竹径近正面持竹杖，头端正平视含笑、另一手拢袖，以大半身表现前行意向，不露脚",
    reportAction: "暂停用途派生；持杖行走已用于本轮揭晓，不直接当作独立报告图",
    posterAction: "暂停用途派生；新版揭晓候选复看后再定独立海报构图",
    boundary:
      "雨杖借词作、具体行走艺术化；578×1252实际取景仅候选，未放大冒称高清，正式分辨率和叠字待测",
  },
  {
    id: "tang-yin",
    costume: "墨绿/赭金明风宽袍，竹石线纹，简洁发冠，不套松鹤衣",
    revealAction:
      "大半身前倾侧俯审视山水画，视线沿笔锋落画，执笔手提腕收笔、另一手压纸，不盯镜头，不露脚",
    reportAction: "暂停用途派生；新版揭晓候选复看后再定独立报告构图",
    posterAction: "暂停用途派生；新版揭晓候选复看后再定独立海报构图",
    boundary: "真实绘画身份，具体运笔不复原名作；不点秋香",
  },
  {
    id: "zhou-yu",
    costume:
      "红黑将领锦袍、轻甲护肩与风中披风，利落叠襟；近正面平视，凝定自信有清贵锐气",
    revealAction:
      "楼船船首大半身挺立，一手按腰侧佩剑剑柄、一手扶船栏，背后船阵帆旗，不再琴师回望，不露脚",
    reportAction: "暂停用途派生；新版揭晓候选复看后再定独立报告构图",
    posterAction: "暂停用途派生；新版揭晓候选复看后再定独立海报构图",
    boundary:
      "水军统帅身份据本传，船首姿态艺术化；琴不再主动作，不用白羽扇，不演义嫉妒",
  },
  {
    id: "zhao-yun",
    costume: "银灰冷青衣甲、实丝深色内层；较宽成年下颌、直眉沉稳表情，束发利落",
    revealAction: "马旁整缰，手扶鞍、另一手理缰，半抬脸回应",
    reportAction: "行军休息时坐石系紧护腕，双脚与衣甲有承重关系",
    posterAction: "驻马营门回望，握缰手与鞍部关系清晰，兵器从属",
    boundary: "将领身份；马甲颜色与兵器为艺术造型，不神枪七进七出",
  },
  {
    id: "li-qingzhao",
    costume: "青白层叠细花纱衣，独立珠玉与花簪，保留已认可面孔",
    revealAction: "舟上低坐拨荷叶，另一手扶舷，微前倾看水路",
    reportAction: "窗边坐案翻看金石拓片，手压纸边、侧耳听雨",
    posterAction: "檐下伸手感细雨，另一手轻收袖，面部清楚",
    boundary: "词作回舟与金石阅读入口，具体手势艺术化",
  },
  {
    id: "yang-yuhuan",
    costume: "石榴红藕金暖白厚丝唐风裙，团花/宝相纹与独立金簪；丰润成年",
    revealAction:
      "自然丰润的大半身展袖收帛，双手与披帛接触清楚，头立颈肩、胸腰少扭转后仰，不露脚、不以落地长裙证明比例",
    reportAction: "暂停用途派生；新版可见上半身比例与审美复看后再定独立构图",
    posterAction: "暂停用途派生；新版揭晓候选复看后再定独立海报构图",
    boundary:
      "歌舞音律据史传，收帛姿态艺术化，非霓裳复原；仅审可见比例，不把不可见下肢记为通过，不祸水",
  },
  {
    id: "wu-zetian",
    costume: "深绛紫金暖白厚锦，庄重唐周宫廷轮廓，结构化领袖与独立冠髻",
    revealAction: "御案侧坐展奏牍，抬眼听奏，一手落案缘",
    reportAction: "书斋前倾比看两份卷册，执笔停顿，另一手展卷",
    posterAction: "庭廊扶栏缓步，衣料随步下垂，侧首思量",
    boundary: "文史政事身份，不伪造诏令，不把暴力权术作用户优点",
  },
  {
    id: "wang-zhaojun",
    costume: "黛青绛红厚丝披风、暖白内层，简洁汉风发饰，远行轮廓",
    revealAction: "驻马拢披风，一手扶鞍，回望关山",
    reportAction: "驿舍案旁整理行囊，指尖收束系带，视线望向窗外",
    posterAction: "道路旁侧身扶马，风牵披风，面孔与眼神清楚",
    boundary: "出塞史实，具体动作艺术化；无琵琶高手/主动志愿断言",
  },
  {
    id: "cai-wenji",
    costume:
      "雾蓝月白汉风密实交领裙，银丝芦草/兰叶与细枝疏花，柔韧丝缎层次，整洁发髻与朴雅玉簪",
    revealAction:
      "大半身近正面略俯核对旧卷，目光明确落卷，一手持待核卷页、另一手停笔，平静思索而不侧歪讨镜头，不露脚",
    reportAction: "暂停用途派生；新版揭晓候选复看后再定独立报告构图",
    posterAction: "暂停用途派生；新版揭晓候选复看后再定独立海报构图",
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
