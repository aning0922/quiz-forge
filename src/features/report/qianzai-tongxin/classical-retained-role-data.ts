import type { QianzaiClassicalRoleProfile } from "./classical-edition";
import { qianzaiTenRoleArtRefs } from "./ten-role-contract";
/** Static editorial prose retained from the four continuing roles. New refs are
 * distinct; old reports, source aliases and resource approvals are untouched. */
export const QIANZAI_CLASSICAL_RETAINED_ROLE_DATA = [
  {
    profile: {
      ref: {
        productId: "qianzai-tongxin",
        id: "li-bai",
        version: "2.0.0",
      },
      displayName: "李白",
      honorific: "诗仙",
      aliasSeal: ["青莲", "居士"],
      identitySubtitle: "从山河与明月，走近李白的诗境。",
      tags: ["浪漫", "自由", "想象力", "真性情"],
      posterTagline: "诗意长存",
      posterTags: ["山河", "明月", "诗意"],
      invitation: "往后的路，照自己的步调走。",
      baseLines: [
        "愿你走过山河，仍愿抬头看月亮。",
        "让眼前的一次停留，也成为风景。",
      ],
      closureLines: ["山河有尽", "同心无涯"],
      history: {
        title: "诗仙小传 · 李白",
        timeline: [
          {
            title: "游历山河",
            text: "李白曾游历各地，山水与见闻进入他的诗篇。《庐山谣》里的名山江流、《关山月》中的长风关山，都展现了开阔的诗境。",
          },
          {
            title: "长安岁月",
            text: "唐玄宗天宝元年（742年），李白奉召入长安，任翰林供奉，后来离京。仕途与远游交织，构成了他人生中的一段转折。",
          },
          {
            title: "诗名与作品",
            text: "李白的诗运用丰富的想象，后世称他为“诗仙”，诗文汇入《李太白集》。走近他的作品，可以读山河，也可以读诗人在具体处境中的声音。",
          },
        ],
        sourceNote:
          "人物事实参照故宫博物院“李白”词条；作品据《庐山谣》《关山月》原文。画面为艺术想象，不是历史肖像。",
      },
      lifespan: "701—762 · 唐代诗人",
      courtesyName: "字太白 · 号青莲居士",
      quotes: [
        {
          id: "li-bai-lushan",
          text: "我本楚狂人，凤歌笑孔丘。",
          source: "李白《庐山谣寄卢侍御虚舟》",
          sourceUrl: "https://zh.wikisource.org/wiki/廬山謠寄盧侍御虛舟",
        },
        {
          id: "li-bai-guanshan",
          text: "长风几万里，吹度玉门关。",
          source: "李白《关山月》",
          sourceUrl: "https://zh.wikisource.org/wiki/關山月_(李白)",
        },
      ],
      sourceKind: "documented-historical",
    } satisfies QianzaiClassicalRoleProfile,
    copy: {
      opening: [
        "李白的诗里，山河与明月常常把眼前的路带向远方。这一卷从作品出发，留一段可以自由阅读的旅程。",
        "不必把诗中的人物当成自己的定论。一个画面、一句诗，也可以只是重新看待日常的入口。",
      ],
      echo: "这一卷借李白的山河诗境作参照，把眼前的选择放进更开阔的想象。",
      historyIntro: "游历、入京与诗名，串起诗人的一段人生。",
      historySources: [
        {
          label: "故宫博物院：李白（纪年、字号、游历、翰林供奉、诗名）",
          url: "https://www.dpm.org.cn/lemmas/240150.html",
        },
        {
          label: "李白《庐山谣寄卢侍御虚舟》",
          url: "https://zh.wikisource.org/wiki/廬山謠寄盧侍御虛舟",
        },
        {
          label: "李白《关山月》",
          url: "https://zh.wikisource.org/wiki/關山月_(李白)",
        },
      ],
      whyByTopic: {
        exploration:
          "李白诗中的名山江流与长风关山，把视野从眼前带向远处。你的尝试与投入也为经验打开不同入口；相呼应的是看待世界的开阔视角，不是必须不断远行。",
        voice:
          "李白以“我本楚狂人”写出鲜明的自我声音。你的表达与商量，可以与诗中不抹去自身声音的姿态并读；说清自己的位置，也容得下与他人同行。",
        care: "李白借山河明月寄放心绪，风景不只有壮阔，也能承载人的感受。你选择如何回应他人，可以与这种让感受进入表达的写法相照见，而不必被概括成某种固定性格。",
        action:
          "李白把游历中的山水见闻写进诗篇。你在体验与准备之间选择起步方式，与从具体经历获得表达材料这一点相连；相似不在于行得多远，而在于怎样走近眼前的事。",
        change:
          "李白诗中的视野在山川、长风与关山之间展开。你对活动次序与主体的调整，也是在重新看各部分的关系；这是一处观察方式的呼应，不等于你与诗人有相同的应变能力。",
      },
      neutralWhy: [
        "李白的诗里，山河与明月常常把眼前的路带向远方。这一卷从作品出发，留一段可以自由阅读的旅程。",
        "可以先留住一句有感触的话，再看看它与今天的生活怎样相遇。这一卷为阅读留一个入口，也为之后的新选择留一处空隙。",
      ],
      closing: [
        "愿你认真走路，也常常抬头。",
        "不妨选一件眼前可以开始的小事，做过以后，再回看自己的感受。",
        "山河有尽，同心无涯。",
      ],
    },
    resourceRefs: qianzaiTenRoleArtRefs("li-bai"),
  },
  {
    profile: {
      ref: {
        productId: "qianzai-tongxin",
        id: "su-shi",
        version: "2.0.0",
      },
      displayName: "苏轼",
      honorific: "东坡",
      aliasSeal: ["东坡", "居士"],
      identitySubtitle: "从途中风雨，走近苏轼的词境。",
      tags: ["烟火", "旷达", "诗文", "多面"],
      posterTagline: "风雨徐行",
      posterTags: ["风雨", "吟啸", "人间"],
      invitation: "愿风雨经过，也容得下一声吟啸。",
      baseLines: [
        "愿你途经风雨，也有徐行的余地。",
        "让一餐一景，留下自己的回声。",
      ],
      closureLines: ["风雨有时", "人间可亲"],
      history: {
        title: "人物小传 · 苏轼",
        timeline: [
          {
            title: "入仕与迁转",
            text: "苏轼于1057年中进士，后来历任密州、徐州、湖州等地官职。此后又经历贬谪与起用，仕宦迁转与各地生活构成了他人生的重要背景。",
          },
          {
            title: "黄州与词赋",
            text: "苏轼曾贬居黄州。《定风波》的题序记下沙湖道中遇雨，《前赤壁赋》则从江上泛舟展开问答。风雨、江月与身世之思，在不同文体中各有写法。",
          },
          {
            title: "诗文之外的书画",
            text: "苏轼兼擅诗词、文章、书法与绘画，传世书迹有《黄州寒食诗帖》等。文字与笔墨之外，不能忽略他曾经历的具体波折；“旷达”也不是他唯一的面貌。",
          },
        ],
        sourceNote:
          "人物事实参照故宫博物院“苏轼”词条；作品据《定风波》《前赤壁赋》原文。画面为艺术想象，不是历史肖像。",
      },
      lifespan: "1037—1101 · 北宋文学家",
      courtesyName: "字子瞻 · 号东坡居士",
      quotes: [
        {
          id: "su-shi-xuxing",
          text: "何妨吟啸且徐行。",
          source: "苏轼《定风波·莫听穿林打叶声》",
          sourceUrl: "https://zh.wikisource.org/wiki/定風波_(莫聽穿林打葉聲)",
        },
        {
          id: "su-shi-guiqu",
          text: "归去，也无风雨也无晴。",
          source: "苏轼《定风波·莫听穿林打叶声》",
          sourceUrl: "https://zh.wikisource.org/wiki/定風波_(莫聽穿林打葉聲)",
        },
      ],
      sourceKind: "documented-historical",
    } satisfies QianzaiClassicalRoleProfile,
    copy: {
      opening: [
        "苏轼的《定风波》里，有雨中的吟啸，也有酒醒后的微凉。舒展与波折，都在同一段路上。",
        "这一卷借作品看生活的层次。读到哪一句有所触动，就在那里停一停，不必替自己安排唯一的样子。",
      ],
      echo: "这一卷借东坡途中遇雨的词境作参照，容纳同一段路上的不同感受。",
      historyIntro: "从仕宦迁转与多种创作，认识东坡。",
      historySources: [
        {
          label: "故宫博物院：苏轼（纪年、字号、仕宦、书画）",
          url: "https://www.dpm.org.cn/lemmas/242068.html",
        },
        {
          label: "苏轼《定风波·莫听穿林打叶声》及题序",
          url: "https://zh.wikisource.org/wiki/定風波_(莫聽穿林打葉聲)",
        },
        {
          label: "苏轼《前赤壁赋》",
          url: "https://zh.wikisource.org/wiki/前赤壁賦",
        },
      ],
      whyByTopic: {
        exploration:
          "苏轼的诗词、文章与书画呈现不同表达路径。你为不同兴趣与投入安排步调，可以与这种多面的创作视野相照见；相连的是经验有不同入口，不是才华或成就的比较。",
        voice:
          "《定风波》以吟啸写出行路者自己的声调，也保留同路遇雨的处境。你的主张与商量，可以借这幅画面理解：共同的路上，仍能说清自己的感受与位置。",
        care: "《定风波》既有雨中的吟啸，也有酒醒后的微冷。你对事情与感受的回应，与词中容纳不同心绪的层次相呼应；不必把自己要求成永远轻松的人。",
        action:
          "《定风波》从沙湖道中遇雨这一段具体行路展开。你按事情的条件决定怎样起步，也可以与它相照见：先看脚下处境，再找到自己的步调，而非只用一个标签概括行动。",
        change:
          "《定风波》写遇雨，也写雨后转晴，同一段路的条件在变化。你对安排的重组与保留，与词中在不同处境里继续行路的画面相呼应；这不表示现实困难总能轻易化解。",
      },
      neutralWhy: [
        "苏轼的《定风波》里，有雨中的吟啸，也有酒醒后的微凉。舒展与波折，都在同一段路上。",
        "可以先留住一句有感触的话，再看看它与今天的生活怎样相遇。这一卷为阅读留一个入口，也为之后的新选择留一处空隙。",
      ],
      closing: [
        "愿你走得从容，也如实照顾自己的冷暖。",
        "不妨选一件眼前可以开始的小事，做过以后，再回看自己的感受。",
        "风雨有时，人间可亲。",
      ],
    },
    resourceRefs: qianzaiTenRoleArtRefs("su-shi"),
  },
  {
    profile: {
      ref: {
        productId: "qianzai-tongxin",
        id: "li-qingzhao",
        version: "2.0.0",
      },
      displayName: "李清照",
      honorific: "易安",
      aliasSeal: ["易安", "居士"],
      identitySubtitle: "从溪亭旧游与云涛星河，走近李清照的词境。",
      tags: ["细读", "记忆", "游兴", "想象"],
      posterTagline: "词心有光",
      posterTags: ["溪亭", "云涛", "词心"],
      invitation: "愿细微心意，也能向云涛展开。",
      baseLines: [
        "愿你珍惜细微心意，也抬眼看远方。",
        "让这一程相逢，留住自己的声音。",
      ],
      closureLines: ["光阴可记", "词心自明"],
      history: {
        title: "词人小传 · 李清照",
        timeline: [
          {
            title: "词中的旧游与梦境",
            text: "《如梦令》保存溪亭日暮、回舟与藕花的旧游画面，《渔家傲》又把梦境推向云涛星河。细微的游兴与辽阔的想象，共同构成她词作的不同声调。",
          },
          {
            title: "与赵明诚共治金石",
            text: "李清照在《金石录后序》中记述，婚后与赵明诚搜集书画、碑刻与古器，并共同勘校书籍。收藏不只是陈列，也包含查考、整理与反复阅读。",
          },
          {
            title: "南渡之后的记录",
            text: "南渡过程中，李清照经历藏品散失与生活变迁。《金石录后序》回望收藏的聚散，留下个人亲历的记录，也让后人看见作品之外的具体人生。",
          },
        ],
        sourceNote:
          "纪年用通行约数；收藏与南渡经历据本人《金石录后序》，词作据《如梦令》《渔家傲》。画面为艺术想象，不是历史肖像。",
      },
      lifespan: "1084—约1155 · 宋代词人",
      courtesyName: "号易安居士",
      quotes: [
        {
          id: "li-qingzhao-xiting",
          text: "常记溪亭日暮，沉醉不知归路。",
          source: "李清照《如梦令·常记溪亭日暮》",
          sourceUrl:
            "https://zh.wikisource.org/zh-hans/如夢令_(李清照)/如夢令_(常記溪亭日暮)",
        },
        {
          id: "li-qingzhao-fengpeng",
          text: "天接云涛连晓雾，星河欲转千帆舞。",
          source: "李清照《渔家傲·天接云涛连晓雾》",
          sourceUrl: "https://zh.wikisource.org/zh-hans/漁家傲_(李清照)",
        },
      ],
      sourceKind: "documented-historical",
    } satisfies QianzaiClassicalRoleProfile,
    copy: {
      opening: [
        "与你相逢的，是把溪亭旧游与云涛星河写进词里的李清照。细微的日常与辽阔的想象，在她的作品中并肩展开。",
        "读这一卷，可以从一句词、一个画面开始。不急着给自己下结论，先看看哪一处让你愿意停留。",
      ],
      echo: "这一卷借易安的词作文学参照：既细读日常，也让想象越过眼前。",
      historyIntro: "词作、金石与南渡，展开词人的不同侧面。",
      historySources: [
        {
          label: "杭州政协：李清照（1084—约1155、号易安居士）",
          url: "https://www.hzzx.gov.cn/hzzx/content/2010-10/26/content_5139226.htm",
        },
        {
          label: "李清照《金石录后序》",
          url: "https://zh.wikisource.org/wiki/金石錄後序_(李清照)",
        },
        {
          label: "李清照《如梦令·常记溪亭日暮》",
          url: "https://zh.wikisource.org/zh-hans/如夢令_(李清照)/如夢令_(常記溪亭日暮)",
        },
        {
          label: "李清照《渔家傲》",
          url: "https://zh.wikisource.org/zh-hans/漁家傲_(李清照)",
        },
      ],
      whyByTopic: {
        exploration:
          "李清照既写溪亭旧游，也在《渔家傲》中展开云涛星河。你的熟悉与尝试，可以与这两种视野相照见：细读眼前的经验，也为另一种可能留位置。",
        voice:
          "李清照把旧游与梦境写成自己的词中声音。你如何表达选择、如何与人商量，可以与这种不让个人经验消失的写法并读；相连的是表达有自己的位置，不是替你判定强弱。",
        care: "《如梦令》把日暮、回舟与藕花的细节留在词里。你对感受与具体事情的回应，与这种认真辨认生活声色的目光相呼应；细读心意，也可以与寻找办法并行。",
        action:
          "李清照在词中保存泛舟旧游，又借梦境向远处展开。你选择怎样开始体验，可以与这种让经历进入表达的路径并读；一次具体接触，也能成为重新认识日常的起点。",
        change:
          "从溪亭回舟到云涛星河，李清照的词容纳了不同情境与观看角度。你对安排范围的调整，可以与这种转换视角的写法相照见；文学想象并不是应变能力的证明。",
      },
      neutralWhy: [
        "与你相逢的，是把溪亭旧游与云涛星河写进词里的李清照。细微的日常与辽阔的想象，在她的作品中并肩展开。",
        "可以先留住一句有感触的话，再看看它与今天的生活怎样相遇。这一卷为阅读留一个入口，也为之后的新选择留一处空隙。",
      ],
      closing: [
        "愿你记得一日的声色，也写得下远方。",
        "不妨选一件眼前可以开始的小事，做过以后，再回看自己的感受。",
        "光阴可记，词心自明。",
      ],
    },
    resourceRefs: qianzaiTenRoleArtRefs("li-qingzhao"),
  },
] as const;
