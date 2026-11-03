import type { QianzaiKnownRoleId } from "./known-ten-catalog";
/** Composition plans only, not generated art, author visual acceptance or resource hashes.
 * Name art remains a separate 5:7 diagonal, optically centered group at the original
 * lower anchor; neither the prefix nor seal is moved to compensate for name length. */
export const QIANZAI_KNOWN_ROLE_ART_PLAN = [
  {
    id: "li-bai",
    costume: "蓝白宽袖丝衣，墨意线金；保留已认可个体面孔与风拂长发",
    revealAction: "临水斜倚石栏举杯，手肘承重，仰望月光",
    reportAction: "坐在临江低案旁展开写诗材料，视线落在窗外水面",
    posterAction: "江岸迎风抬臂举杯，衣袖形成开放斜线",
    boundary: "《月下独酌》作品意象，具体姿态艺术化",
  },
  {
    id: "su-shi",
    costume: "靛蓝银灰暖白厚锦袍，云/几何边纹，成熟俊朗与精心短须",
    revealAction: "棋枰侧坐，肘支案，一手捻子停顿，抬眼邀共弈",
    reportAction: "雨后竹杖触地行走，另一手收袍角，重心在迈步",
    posterAction: "廊下倚栏看雨后庭院，杯在低案，衣料有坐靠重量",
    boundary: "棋局艺术化，不作棋力史实；雨杖借词作",
  },
  {
    id: "tang-yin",
    costume: "墨绿/赭金明风宽袍，竹石线纹，简洁发冠，不套松鹤衣",
    revealAction: "大画案前舒展运笔，另一手扶画幅边，画纸与手笔有接触",
    reportAction: "侧坐比看画幅与窗外山景，执笔手暂停，另一手扶案",
    posterAction: "背靠画屏轻转身，收起画笔与砚盒，视线接观众",
    boundary: "真实绘画身份，具体运笔不复原名作；不点秋香",
  },
  {
    id: "zhou-yu",
    costume: "玄青暗红将领锦袍与少量护肩，利落叠襟，独立束发",
    revealAction: "水榭侧坐听曲，指尖停在案沿，侧首回顾画外声源",
    reportAction: "营帐中立于案边展开图，一手压图、一手指近处路线",
    posterAction: "临水船边倚栏听风，带鞘佩剑从属，衣料厚重",
    boundary: "辨音据本传；不指定独门乐器，不演义嫉妒",
  },
  {
    id: "zhao-yun",
    costume: "银灰冷青衣甲、实丝深色内层，明确肩腕与系带，英朗成人骨相",
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
    revealAction: "一次转身收袖的舞步，双臂牵动披帛，脚步明确承重",
    reportAction: "水榭坐歇，手拢披帛，侧身听远处乐声，裙料随座垂落",
    posterAction: "庭廊缓步回身，抬手收住一段披帛，目光连接观众",
    boundary: "歌舞音律据史传，具体舞步非霓裳复原，不祸水",
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
    costume: "墨碧暖杏汉风密实交领裙，细几何边饰，整洁发髻与朴雅玉簪",
    revealAction: "灯下席坐缮书，执笔接纸，另一手移卷，沉静抬眼",
    reportAction: "窗旁整理典册，将两卷并置，肩肘有案面支撑",
    posterAction: "廊下低坐持一页材料，另一手扶案，不固定抱书站立",
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
