import type { QianzaiClassicalRoleProfile } from "./classical-edition";
import { qianzaiTenRoleArtRefs, qianzaiTenRoleRef } from "./ten-role-contract";

const wangPoem = "https://zh.wikisource.org/wiki/山居秋暝";
const wangBiography = "https://zh.wikisource.org/wiki/舊唐書/卷190下";
const xueCollection = "https://zh.wikisource.org/wiki/全唐詩/卷803";
const xieBiography = "https://zh.wikisource.org/wiki/晉書/卷096";

/** Historical identity and literary parallels remain separate. The following
 * prose supplies no scoring rules or reader-specific claims. */
export const QIANZAI_CLASSICAL_POET_ROLE_DATA = [
  {
    profile: {
      ref: qianzaiTenRoleRef("wang-wei"),
      displayName: "王维",
      honorific: "摩诘",
      sourceKind: "documented-historical",
      lifespan: "唐代诗人 · 兼擅书画",
      courtesyName: "字摩诘",
      identitySubtitle: "从松间明月与山居人声，走近王维的诗境。",
      tags: ["松间", "山居", "诗画", "往来"],
      posterTagline: "清泉有声",
      posterTags: ["松月", "清泉", "诗画"],
      invitation: "在眼前一景里，也有可以细读的天地。",
      baseLines: ["愿你留意清泉，也听见归舟。", "停留片刻，让心意有处安放。"],
      closureLines: ["松间有月", "清泉有声"],
      quotes: [
        {
          id: "wang-wei-qingquan",
          text: "明月松间照，清泉石上流。",
          source: "王维《山居秋暝》",
          sourceUrl: wangPoem,
        },
        {
          id: "wang-wei-guizhou",
          text: "竹喧归浣女，莲动下渔舟。",
          source: "王维《山居秋暝》",
          sourceUrl: wangPoem,
        },
      ],
      history: {
        title: "人物小传 · 王维",
        timeline: [
          {
            title: "诗名与仕宦",
            text: "《旧唐书》记王维字摩诘，开元九年进士及第，后来历任拾遗、监察御史等职，官至尚书右丞。山水诗名之外，他也经历着朝廷任职与时代变迁。",
          },
          {
            title: "诗、书与画",
            text: "本传记述王维以诗知名，兼擅书画，并谈到他对山水平远与云峰石色的经营。文字与图像是认识他的不同入口，不能只用安静二字概括。",
          },
          {
            title: "辋川的往来",
            text: "王维居辋川别业时，与裴迪浮舟往来、弹琴赋诗，田园作品结为《辋川集》。《山居秋暝》里的松月清泉，也与浣女、渔舟的生活声息相伴。",
          },
        ],
        sourceNote:
          "人物经历据《旧唐书》卷一百九十下，诗句据《山居秋暝》。不据异说补写生年；画面为艺术想象。",
      },
    } satisfies QianzaiClassicalRoleProfile,
    copy: {
      opening: [
        "与你相逢的，是把松间明月、石上清泉写入诗中的王维。他的山居并不寂无人声，竹林有归来的浣女，莲叶间有下行的渔舟。",
        "这一卷可以读得慢一些：留意一处光影，听清一个声音，也看看人与景怎样在同一首诗里相遇。",
      ],
      echo: "这一卷借王维的山居诗境作参照，在细看的景物里，也听见具体的人间往来。",
      historyIntro: "从仕宦、诗画与辋川生活，认识山水诗境之外的人。",
      historySources: [
        { label: "《旧唐书》卷一百九十下 · 王维传", url: wangBiography },
        { label: "王维《山居秋暝》", url: wangPoem },
      ],
      whyByTopic: {
        exploration:
          "王维经营诗画中的山水，也把熟悉的泉石写出不同层次。借这个片段，可以想到探索既能向远处展开，也能向眼前的细节继续深入。",
        voice:
          "《山居秋暝》以自己的诗句安排松月、泉流与人声，让一处山居有了独特的观看方式。它为表达自己的感受留一个入口，也容得下同一景物中的他人。",
        care: "竹林里归来的浣女、莲叶间下行的渔舟，让山水不只剩下景色。诗中对这些声音与动静的留意，给关照眼前的人与事添了一处文学参照。",
        action:
          "《山居秋暝》从雨后的环境写起，再让光、声音与舟行逐次出现。借这样的阅读次序，可以回看自己怎样认识眼前条件，再决定接下来的一步。",
        change:
          "诗中清泉流动、渔舟下行，山居的整体画面仍然连贯。这里仅借作活动安排的参照：可以保留重要的结构，也为局部变化留出位置。",
      },
      neutralWhy: [
        "可以先从一句松月清泉读起，再听见竹林与莲叶之间的人声。这次人物相逢，为日常留下一处细看的位置。",
        "愿意停留的细节可以记下来：一处光影、一次往来，或一段还想继续读的文字。它与自己的联系，无须在此刻说完。",
      ],
      closing: [
        "愿你在忙碌之中，仍有看清眼前一景的余地。",
        "找一处熟悉的地方，留意今天与昨日不同的一点，再把它记在心里。",
        "松间有月，清泉有声。",
      ],
    },
    resourceRefs: qianzaiTenRoleArtRefs("wang-wei"),
  },
  {
    profile: {
      ref: qianzaiTenRoleRef("xue-tao"),
      displayName: "薛涛",
      honorific: "洪度",
      sourceKind: "documented-historical",
      lifespan: "唐代诗人 · 生活于蜀地",
      courtesyName: "字洪度",
      identitySubtitle: "从江上赠别与小笺往来，走近薛涛的诗篇。",
      tags: ["诗笺", "唱和", "江上", "友人"],
      posterTagline: "尺素有声",
      posterTags: ["诗笺", "江柳", "相知"],
      invitation: "愿写下的心意，找到愿意细读的人。",
      baseLines: [
        "愿一纸心意，也能抵达远处。",
        "把今天看见的，认真写成自己的句子。",
      ],
      closureLines: ["江柳有信", "尺素有声"],
      quotes: [
        {
          id: "xue-tao-songyou",
          text: "水国蒹葭夜有霜，月寒山色共苍苍。",
          source: "薛涛《送友人》",
          sourceUrl: xueCollection,
        },
        {
          id: "xue-tao-songyao",
          text: "万条江柳早秋枝，袅地翻风色未衰。",
          source: "薛涛《送姚员外》",
          sourceUrl: xueCollection,
        },
      ],
      history: {
        title: "人物小传 · 薛涛",
        timeline: [
          {
            title: "在蜀地写诗",
            text: "《全唐诗》卷八百三小传记薛涛字洪度，随父入蜀，后来以诗受到关注。她的作品不只有相思，也写山水、器物、赠答与亲历的处境。",
          },
          {
            title: "赠答与唱和",
            text: "本卷收录《送友人》《送姚员外》及多篇酬答之作。霜夜蒹葭与早秋江柳，把远行和离别写成可感的景象，也留下诗人与友人交往的痕迹。",
          },
          {
            title: "浣花溪与小笺",
            text: "卷首小传记她晚年居浣花溪，喜制小笺，时称薛涛笺。诗句与书写的纸张，在这段记载里相连；对纸笺的想象，不等同于每一种后世传说都已证实。",
          },
        ],
        sourceNote:
          "人物记载与诗句据《全唐诗》卷八百三；生卒异说不在此定论。画面为艺术想象，不把赠答关系补写成未经证实的爱情故事。",
      },
    } satisfies QianzaiClassicalRoleProfile,
    copy: {
      opening: [
        "与你相逢的，是在诗中写江上山色、赠别与唱和的薛涛。一张小笺可以承载自己的观看，也可以成为与他人来往的桥梁。",
        "这一卷从她留下的诗篇出发。读一处江柳，留意一句赠答，让那些具体的声音重新抵达眼前。",
      ],
      echo: "这一卷借薛涛的诗笺与赠答作参照，让自己的表达与对他人的留意一起出现。",
      historyIntro: "诗作、友人往来与小笺，展开诗人的几个侧面。",
      historySources: [
        { label: "《全唐诗》卷八百三 · 薛涛及诗作", url: xueCollection },
      ],
      whyByTopic: {
        exploration:
          "薛涛的诗从江上山色写到庭中草木，熟悉的景物也有不同的观看方式。借她的诗篇，可以想到一次新的尝试，也可以从已经喜爱的事物继续发现细节。",
        voice:
          "赠答诗既回应友人，也留下薛涛自己的句子与景象。把彼此的关系放进考虑，仍然可以保有自己的表达，这是诗笺往来提供的一处文学回声。",
        care: "《送友人》里的寒月山色、《送姚员外》里的江柳，都把离别中的牵挂写进景物。它们让对他人的留意有了具体形状，也提醒阅读回到眼前的一次相处。",
        action:
          "一段心意成为赠答之作，需要落到具体的字句与纸笺。借这个书写的画面，可以回看自己怎样把想做的事缩小到眼前能够开始的一步。",
        change:
          "小笺的篇幅有限，写下哪些内容、留出多少空白，需要结合这一次往来的情境。这里仅借作活动安排的参照，看看哪些主体保留，哪些细节可以调整。",
      },
      neutralWhy: [
        "这一回可以先读薛涛留下的山色与江柳，再看看赠答诗里怎样容纳一份牵挂。相逢从阅读开始，也可以暂时停在阅读本身。",
        "若有一句愿意留下，不妨抄在一张小纸上。它可以送给想起的人，也可以留给今天的自己。",
      ],
      closing: [
        "愿你的心意有自己的句子，也遇见愿意细读的人。",
        "可以写下一件今天看见的小事，或向一个想起的人问一声近况。",
        "江柳有信，尺素有声。",
      ],
    },
    resourceRefs: qianzaiTenRoleArtRefs("xue-tao"),
  },
  {
    profile: {
      ref: qianzaiTenRoleRef("xie-daoyun"),
      displayName: "谢道韫",
      honorific: "咏絮",
      sourceKind: "documented-historical",
      lifespan: "东晋人物 · 见于史传与志人故事",
      identitySubtitle: "从雪中柳絮的比喻，走近谢道韫的言语与人生。",
      tags: ["咏雪", "清谈", "诗文", "林下"],
      posterTagline: "风起有声",
      posterTags: ["柳絮", "清谈", "诗文"],
      invitation: "愿眼前的寻常，也能唤起自己的说法。",
      baseLines: [
        "愿你说出的比喻，照见自己的观看。",
        "有话愿意表达，也有余地细听。",
      ],
      closureLines: ["柳絮因风", "言语有光"],
      quotes: [
        {
          id: "xie-daoyun-liuxu",
          text: "未若柳絮因风起。",
          source: "《晋书》卷九十六 · 记谢道韫语",
          sourceUrl: xieBiography,
        },
        {
          id: "xie-daoyun-wenzhi",
          text: "听其所问，殊开人胸府。",
          source: "《晋书》卷九十六 · 记谢道韫语",
          sourceUrl: xieBiography,
        },
      ],
      history: {
        title: "人物小传 · 谢道韫",
        timeline: [
          {
            title: "家中咏雪",
            text: "《晋书》记一次家中聚会忽逢大雪，谢安问雪像什么，谢道韫以随风而起的柳絮作比。这个片段留下了她的观看与表达，也成为后世咏絮之称的来源。",
          },
          {
            title: "言语与论议",
            text: "史传还记她参与论议，曾接续王献之与宾客的讨论。咏雪之外，这些记载让人看到她在交谈中的表达；史书的称赞与人物真实的全部人生，仍有距离。",
          },
          {
            title: "会稽的相见",
            text: "经历孙恩之乱、失去亲人后，谢道韫居于会稽。太守刘柳来访，史传记二人从家事谈到所问之事，她也说来人的问题使胸怀为之打开。这段经历不能被轻轻化作性格标签。",
          },
        ],
        sourceNote:
          "人物与引语据《晋书》卷九十六；咏雪也是志人故事传统中的著名片段。生卒未在此补定，画面为艺术想象。",
      },
    } satisfies QianzaiClassicalRoleProfile,
    copy: {
      opening: [
        "与你相逢的，是在雪中想到柳絮的谢道韫。相同的一场雪，经由不同的眼光，也可以有各自鲜明的说法。",
        "这一卷从那句比喻开始，也读她在史传中的论议与相见。让一句话引出更多观看，而不急着用才女二字说尽一个人。",
      ],
      echo: "这一卷借谢道韫的咏雪与交谈作参照，让观看、表达与倾听在同一场相逢中展开。",
      historyIntro: "咏雪之外，再读论议与会稽相见的记载。",
      historySources: [
        { label: "《晋书》卷九十六 · 谢道韫", url: xieBiography },
      ],
      whyByTopic: {
        exploration:
          "把雪比作随风而起的柳絮，让眼前景象与另一种经验相遇。借这个片段，可以想到发现新角度的过程；它为探索留出想象，并不替读者评定才华。",
        voice:
          "面对同一个咏雪的问题，谢道韫给出自己的比喻。她的说法由具体观看而来，给这一回怎样表达心意，留下一处清楚而有限的文学参照。",
        care: "《晋书》记谢道韫与刘柳相见时，从家事谈到对方的问题。相处里既有自己的声音，也有听见来人所问的片刻，关照可以从这样的细处开始。",
        action:
          "史传里的论议，需要先听清正在讨论的内容，再接着说出自己的理解。借这一画面，可以回看一次决定所需的信息，以及怎样迈出合适的一步。",
        change:
          "同一场咏雪因不同的比喻展开新的谈话。这里仅借作活动安排的参照：共同的主题可以继续保留，表达和组织的方式也可以重新商量。",
      },
      neutralWhy: [
        "可以先把随风柳絮与眼前的雪放在一起，再读一段交谈的记载。人物相逢提供一个新的观看角度，自己的生活仍有许多待写的部分。",
        "不妨留意最近一次想换一种说法的时刻。把那句话写下来，看看它是否更接近今天想表达的心意。",
      ],
      closing: [
        "愿你的观看有自己的说法，也容得下别人带来的新问题。",
        "从今天的一件小事里找一个贴切的比喻，写给自己，或与愿意倾听的人说一说。",
        "柳絮因风，言语有光。",
      ],
    },
    resourceRefs: qianzaiTenRoleArtRefs("xie-daoyun"),
  },
] as const;
