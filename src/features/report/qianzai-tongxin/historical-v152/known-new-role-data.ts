import type { QianzaiClassicalRoleProfile } from "@/features/report/qianzai-tongxin/historical-v152/classical-edition";
import { qianzaiKnownRoleArtRefs } from "@/features/report/qianzai-tongxin/historical-v152/known-ten-catalog";
/** Original fixed editorial data for the seven newly selected historical people.
 * whyByTopic is a literary parallel only: integration attaches it exclusively to
 * an existing fully supported theme; role identity/score alone grants no claim.
 * All narrator quotations retain attribution; no character's invented self-quote. */
export const QIANZAI_KNOWN_NEW_ROLE_DATA = [
  {
    profile: {
      ref: {
        productId: "qianzai-tongxin",
        id: "tang-yin",
        version: "3.0.0",
      },
      displayName: "唐伯虎",
      honorific: "六如居士",
      identitySubtitle: "从笔下松声，走近真实的唐寅。",
      tags: ["山水", "画笔", "诗境"],
      posterTagline: "笔下有山",
      posterTags: ["山水", "画笔", "诗境"],
      invitation: "留一段时间，认真看眼前的风景。",
      baseLines: [
        "愿你看见山水，也看见一笔一画的来处。",
        "把喜欢的细节，留在今天。",
      ],
      closureLines: ["山色入纸", "笔下生风"],
      history: {
        title: "人物小传 · 唐伯虎",
        timeline: [
          {
            title: "以画为业",
            text: "唐寅是明代画家，字子畏、伯虎，号六如居士。故宫馆藏资料将他列入明四大家，并记载其乡试中举、会试受牵连后转以绘画为业的经历。",
          },
          {
            title: "山路与松声",
            text: "《山路松声》是唐寅在1516年为吴县知县李经绘制的赠别作品。山体、松树、溪流与人物组织在同一画面里，画上题诗又把观看引向倾听。",
          },
          {
            title: "真实画家与后世故事",
            text: "画作、题诗和以画为生的经历，是认识唐寅的可靠入口。电影中的点秋香情节不进入这份人物小传，后世才子形象也不替代具体作品。",
          },
        ],
        sourceNote:
          "人物据国立故宫博物院《山路松声》藏品说明；两条引句均为画上唐寅题诗，依馆藏释文转为简体。画案动作是艺术构图，不伪造名作或署名。",
      },
      lifespan: "明代画家、诗人",
      courtesyName: "本名唐寅 · 字伯虎、子畏",
      sourceKind: "documented-historical",
      quotes: [
        {
          id: "tang-yin-松声",
          text: "女几山前野路横，松声偏解合泉声。",
          source: "唐寅《山路松声》画上题诗",
          sourceUrl:
            "https://digitalarchive.npm.gov.tw/Collection/Detail/3265?dep=P",
        },
        {
          id: "tang-yin-倾耳",
          text: "试从静里闲倾耳，便觉冲然道气生。",
          source: "唐寅《山路松声》画上题诗",
          sourceUrl:
            "https://digitalarchive.npm.gov.tw/Collection/Detail/3265?dep=P",
        },
      ],
    },
    copy: {
      opening: [
        "先从一笔山石、一段松声走近唐伯虎。真实画家的作品，比后来附着的传奇更值得慢慢看。",
        "这一卷借山水画的观看方式作参照，不把才子故事当作你的经历。",
      ],
      echo: "画面能容下远山，也能容下一个正在细看的瞬间。",
      historyIntro: "从画业、赠别作品与题诗，认识唐寅。",
      historySources: [
        {
          label: "国立故宫博物院：唐寅《山路松声》",
          url: "https://digitalarchive.npm.gov.tw/Collection/Detail/3265?dep=P",
        },
      ],
      whyByTopic: {
        exploration:
          "唐寅把山石、松树与水流带进画面，也让观看有不同的入口。可以借这种观看方式想一想，熟悉与新鲜怎样进入一次具体尝试；绘画成就不用于评价你的创造能力。",
        voice:
          "画上题诗与笔墨共同形成表达，既有自己的落笔，也要顾及整幅关系。你在主张与商量之间的具体选择，可以与这种安排并读，参照停留在表达方式。",
        care: "《山路松声》的题诗从看山转到倾耳听泉，让感受有了具体落点。它可为一次交谈提供观看角度：先听见什么，再回应什么；不由画家身份推出你的共情水平。",
        action:
          "一幅画由具体落笔逐步展开，同时需要看整幅关系。你在先准备或先推进之间的取舍，可借画案上的工作作比照，下一步仍要由眼前任务的代价决定。",
        change:
          "山体、松树与溪流的位置互相联系，局部变化也会影响观看次序。活动安排的保留与重排可以借此理解，但画面组织不等同于你的广义应变能力。",
      },
      neutralWhy: [
        "先看一笔山石如何接上溪水，不急着把画家变成自己的标签。",
        "可以挑一个愿意多看几眼的细节，记下它带来的感受；人物作品只是阅读入口。",
      ],
      closing: [
        "愿你为喜欢的事，留下一次细看的时间。",
        "下次不妨只画一笔或记一处风景，做过以后再决定是否继续。",
        "山色入纸，笔下生风。",
      ],
    },
    resourceRefs: qianzaiKnownRoleArtRefs("tang-yin"),
  },
  {
    profile: {
      ref: {
        productId: "qianzai-tongxin",
        id: "zhou-yu",
        version: "3.0.0",
      },
      displayName: "周瑜",
      honorific: "周郎",
      identitySubtitle: "从听曲回顾，走近知音儒将周瑜。",
      tags: ["知音", "风度", "筹略"],
      posterTagline: "知音有顾",
      posterTags: ["知音", "风度", "筹略"],
      invitation: "在开口之前，先听清一段声音。",
      baseLines: [
        "愿你听见细节，也听见自己的回应。",
        "让一次停顿，成为交谈的起点。",
      ],
      closureLines: ["清音入耳", "江风有信"],
      history: {
        title: "人物小传 · 周瑜",
        timeline: [
          {
            title: "与孙策相交",
            text: "周瑜字公瑾，庐江舒人。其本传记载他与孙策早年相友善，后来参与孙氏在江东的军事行动。将领身份与交游经历，共同构成了他的历史轮廓。",
          },
          {
            title: "赤壁与筹略",
            text: "《三国志》记载周瑜参与赤壁战事，并叙及其判断与部署。这里保留军事事件的基本位置，不采用借东风或被诸葛亮气死等演义情节。",
          },
          {
            title: "听曲辨音",
            text: "本传另记周瑜留心音乐，听到曲中差误便回顾，因而有相关时谣。这样的记载支持知音形象，却不能直接指定他精通某一种乐器或复原一次演奏。",
          },
        ],
        sourceNote:
          "事实与引句据《三国志》卷54；第一条为史家叙述，第二条为书中所录时谣。听曲侧首为艺术构图，不采用小气嫉妒的演义定型。",
      },
      lifespan: "汉末东吴将领",
      courtesyName: "字公瑾",
      sourceKind: "documented-historical",
      quotes: [
        {
          id: "zhou-yu-音乐",
          text: "瑜少精意于音乐。",
          source: "陈寿《三国志》卷54·周瑜传（史家叙述）",
          sourceUrl: "https://zh.wikisource.org/wiki/三國志/卷54",
        },
        {
          id: "zhou-yu-周郎顾",
          text: "曲有误，周郎顾。",
          source: "《三国志》卷54所录时谣（非周瑜自作）",
          sourceUrl: "https://zh.wikisource.org/wiki/三國志/卷54",
        },
      ],
    },
    copy: {
      opening: [
        "先从一段曲声，走近周瑜。历史上的将领，也留下了听辨音乐的侧面。",
        "这一卷把目光放在声音、细节与回应，不要求你拥有将领或乐人的能力。",
      ],
      echo: "一声回顾，让宏大的历史之外也出现可听见的细节。",
      historyIntro: "交游、战事与音乐，呈现周瑜的不同侧面。",
      historySources: [
        {
          label: "陈寿《三国志》卷54·周瑜传",
          url: "https://zh.wikisource.org/wiki/三國志/卷54",
        },
      ],
      whyByTopic: {
        exploration:
          "周瑜的经历同时涉及军事与音乐，提醒阅读不必只停在一种身份。你对新经验与熟悉兴趣的具体安排，可以借这种多面性打开观察角度，不据此断言你才艺出众。",
        voice:
          "本传中的协作与筹略要放在历史关系里理解。你在说清自己的方向与听取他人意见之间的选择，只与商量的过程并读，不把统兵地位映射成领导力。",
        care: "听曲回顾把注意力落在声音的细处。这一画面可与一次先听感受、再处理事情的交谈相照，但音乐辨赏并不证明读者的情绪识别能力。",
        action:
          "周瑜本传呈现判断与部署的具体过程。你在准备与起步之间怎样选择，可借此关注信息是否足够、下一步是否可行，参照不延伸到军事才能或成功预言。",
        change:
          "历史行动需要联系当时条件，不能只用一个结果概括。活动安排的局部修补与整体重排，也可以先比较各环节关系，再决定改动范围。",
      },
      neutralWhy: [
        "先听一段曲声，再读一段本传，让周郎成为可以认识的人物。",
        "无需由相逢结果推定自己的性格；喜欢的也许只是一个回顾的瞬间。",
      ],
      closing: [
        "愿你在忙碌之间，仍能听清一段声音。",
        "下次交谈先确认一处细节，再给出自己的回应。",
        "清音入耳，江风有信。",
      ],
    },
    resourceRefs: qianzaiKnownRoleArtRefs("zhou-yu"),
  },
  {
    profile: {
      ref: {
        productId: "qianzai-tongxin",
        id: "zhao-yun",
        version: "3.0.0",
      },
      displayName: "赵云",
      honorific: "子龙",
      identitySubtitle: "从具体行止，认识史传中的赵云。",
      tags: ["守护", "行止", "稳重"],
      posterTagline: "行止有据",
      posterTags: ["守护", "行止", "稳重"],
      invitation: "把需要守住的事，说得具体一些。",
      baseLines: [
        "愿你认真看待一份托付，也为行动确认边界。",
        "把稳妥落在眼前的一步。",
      ],
      closureLines: ["行有所守", "进退有度"],
      history: {
        title: "人物小传 · 赵云",
        timeline: [
          {
            title: "追随与任职",
            text: "赵云字子龙，常山真定人，早年在公孙瓒部下，后来追随刘备。本传记有牙门将军、翊军将军等任职，构成其军旅经历的一部分。",
          },
          {
            title: "长阪护卫",
            text: "刘备在当阳长阪被追赶时，赵云保护其幼子与甘夫人脱险，这是本传所记的事件。这里不把后来的七进七出叙事、固定神兵或招式移作史实。",
          },
          {
            title: "失利与收束",
            text: "本传也记赵云与邓芝在箕谷兵弱敌强、作战失利，随后收束军队，未至大败。小传保留这一处境，不将人物写成从不失败的完美英雄。",
          },
        ],
        sourceNote:
          "据《三国志》卷36本传；本传与裴注不同层次不混写。引句均为史家叙述，未伪作赵云格言。马旁整缰与衣甲为艺术造型，不确证白马银枪或独门武艺。",
      },
      lifespan: "汉末三国蜀汉将领",
      courtesyName: "字子龙",
      sourceKind: "documented-historical",
      quotes: [
        {
          id: "zhao-yun-姓名",
          text: "赵云字子龙，常山真定人也。",
          source: "陈寿《三国志》卷36·赵云传（史家叙述）",
          sourceUrl: "https://zh.wikisource.org/wiki/三國志/卷36",
        },
        {
          id: "zhao-yun-箕谷",
          text: "然敛众固守，不至大败。",
          source: "陈寿《三国志》卷36·赵云传（箕谷失利后的史家叙述）",
          sourceUrl: "https://zh.wikisource.org/wiki/三國志/卷36",
        },
      ],
    },
    copy: {
      opening: [
        "赵云的名字常与守护相连，这一卷先回到史传中的具体行动。",
        "可以欣赏一个人物的行止，同时保留自己面对事情时的不同选择。",
      ],
      echo: "把英雄故事放回具体处境，行动与边界便都有了位置。",
      historyIntro: "追随、护卫与失利后的收束，组成更具体的人物轮廓。",
      historySources: [
        {
          label: "陈寿《三国志》卷36·赵云传",
          url: "https://zh.wikisource.org/wiki/三國志/卷36",
        },
      ],
      whyByTopic: {
        exploration:
          "认识赵云不必只看熟悉的传奇，也可回到本传的不同片段。你选择探索或继续深耕时，可借这种阅读方式比较已有认识与新信息，不由武将身份推断冒险偏好。",
        voice:
          "史传中的行动发生在具体关系与责任之中。你如何说明自己的安排、如何与同行者协调，可以据此回看一项真实约定，不能由忠勇故事规定你应当服从谁。",
        care: "长阪护卫是史传事件，不是对你生活的复刻。若本轮具体选择涉及关照他人，可借此问眼前需要保护的究竟是什么，同时确认自己的资源与边界。",
        action:
          "本传既记护卫，也记箕谷失利后的收束。你对先推进或先确认条件的选择，可与这种重视具体处境的读法并照，不把勇敢等同于立刻行动或保证成功。",
        change:
          "箕谷的记载让收束与调整进入人物故事。活动安排受阻时，可以借这处参照关注哪些主体仍需保留，哪些次序可以变动，不把军旅结果当作应变能力评级。",
      },
      neutralWhy: [
        "先把传奇暂放一旁，读一个行动发生时的具体处境。",
        "你无需成为从不失误的英雄；这一卷只留下认识人物的入口。",
      ],
      closing: [
        "愿你想守住的事，有清楚的边界。",
        "下次行动前，先确认一项托付和自己能够承担的范围。",
        "行有所守，进退有度。",
      ],
    },
    resourceRefs: qianzaiKnownRoleArtRefs("zhao-yun"),
  },
  {
    profile: {
      ref: {
        productId: "qianzai-tongxin",
        id: "yang-yuhuan",
        version: "3.0.0",
      },
      displayName: "杨玉环",
      honorific: "贵妃",
      identitySubtitle: "从歌舞与衣纹，走近杨玉环的历史形象。",
      tags: ["歌舞", "盛唐", "华彩"],
      posterTagline: "衣动清光",
      posterTags: ["歌舞", "盛唐", "华彩"],
      invitation: "留意一段旋律，也留意自己的感受。",
      baseLines: [
        "愿你欣赏华彩，也能看见其中的细节。",
        "给今天的一点愉悦，留一个位置。",
      ],
      closureLines: ["衣动清光", "曲有余音"],
      history: {
        title: "人物小传 · 杨玉环",
        timeline: [
          {
            title: "太真与贵妃",
            text: "杨玉环在史传中以杨贵妃为人所知，曾号太真，后来成为唐玄宗贵妃。贵妃是其身份称号，既不代替姓名，也不被当作她的全部人生。",
          },
          {
            title: "歌舞与音律",
            text: "《旧唐书》明确记其善歌舞、通音律，为画面中的舞步提供身份依据。具体转身、收袖、披帛轨迹和衣纹属于艺术构图，不冒称复原霓裳舞谱。",
          },
          {
            title: "马嵬与后世书写",
            text: "杨贵妃在马嵬事变中身亡，后世诗歌、戏曲不断重写这一故事。人物处在宫廷与政治变局之中，这份小传不把复杂历史归罪于女性容貌。",
          },
        ],
        sourceNote:
          "人物基本经历及歌舞音律据《旧唐书》卷51；两条引句均为史家叙述，不是假托本人诗句。画面为古偶艺术想象，体态不作历史肖像考证，不采用红颜祸水判断。",
      },
      lifespan: "唐代历史人物",
      courtesyName: "史传称杨贵妃 · 曾号太真",
      sourceKind: "documented-historical",
      quotes: [
        {
          id: "yang-yuhuan-歌舞",
          text: "善歌舞，通音律。",
          source: "《旧唐书》卷51·杨贵妃传（史家叙述）",
          sourceUrl: "https://zh.wikisource.org/wiki/舊唐書/卷51",
        },
        {
          id: "yang-yuhuan-娘子",
          text: "宫中呼为“娘子”，礼数实同皇后。",
          source: "《旧唐书》卷51·杨贵妃传（史家叙述）",
          sourceUrl: "https://zh.wikisource.org/wiki/舊唐書/卷51",
        },
      ],
    },
    copy: {
      opening: [
        "从一次转身、一段衣纹，走近杨玉环。画面的华彩背后，也有史传中的身份与处境。",
        "这一卷允许你欣赏美，不用把被观看或被宠爱当作自己的价值。",
      ],
      echo: "衣料与旋律的层次，为细看感受留下一段时间。",
      historyIntro: "从身份、歌舞与历史处境，理解华美形象之外的人物。",
      historySources: [
        {
          label: "《旧唐书》卷51·杨贵妃传",
          url: "https://zh.wikisource.org/wiki/舊唐書/卷51",
        },
      ],
      whyByTopic: {
        exploration:
          "歌舞可以让熟悉的旋律与新的观看同时出现。你对尝新与深耕的具体选择，可借此观察什么值得继续接近，不把欣赏华彩直接写成艺术天赋。",
        voice:
          "舞步的表达有自己的节奏，也要与音乐相接。你在表达主张和共同商量之间怎样安排先后，可用这一画面作比照，不把宫廷中的关系变成现代相处规范。",
        care: "一段旋律与一次停顿都能承载感受。若本轮选择支持先听心情，可以借画面提醒自己确认对方的需要；欣赏美感本身不证明善解人意。",
        action:
          "舞蹈画面把动作落在支撑脚与身体转向上。你对准备或先试一步的取舍，可以联系到动作需要条件这一点，具体建议仍取决于任务能否撤回。",
        change:
          "衣袖、步伐与音乐彼此连接，改变一处也会带动观看次序。活动安排的保留与重排可借此观察各环节关系，不据此扩大为所有变化都能从容应对。",
      },
      neutralWhy: [
        "可以只看一次转身如何牵动衣纹，听听自己对此刻画面的感受。",
        "人物的遭际不预告你的未来；欣赏与阅读都不需要认领同样的人生。",
      ],
      closing: [
        "愿日常里的美，有被认真看见的时刻。",
        "下次遇到喜欢的旋律，可以停一小会儿，记下它让你想到什么。",
        "衣动清光，曲有余音。",
      ],
    },
    resourceRefs: qianzaiKnownRoleArtRefs("yang-yuhuan"),
  },
  {
    profile: {
      ref: {
        productId: "qianzai-tongxin",
        id: "wu-zetian",
        version: "3.0.0",
      },
      displayName: "武则天",
      honorific: "女皇",
      identitySubtitle: "从文史与章奏，认识历史中的武则天。",
      tags: ["文史", "政事", "章奏"],
      posterTagline: "落笔有思",
      posterTags: ["文史", "政事", "章奏"],
      invitation: "让一项决定，回到具体条件里。",
      baseLines: [
        "愿你听清自己的想法，也认真确认它的影响。",
        "把下一步写清楚，再为自己留出回看的余地。",
      ],
      closureLines: ["落笔有思", "行事有界"],
      history: {
        title: "人物小传 · 武则天",
        timeline: [
          {
            title: "从宫廷进入政事",
            text: "武则天名曌，先后为唐太宗才人、唐高宗皇后。高宗时期，她参与处理章奏与政事，史书以二圣记当时高宗与武后的并称。",
          },
          {
            title: "称帝与武周",
            text: "690年，武则天称帝，改国号为周。其统治涉及官员任用、制度与政治斗争，不能只凭女皇称号把复杂历史简化成单一励志故事。",
          },
          {
            title: "退位与历史评价",
            text: "705年政局变化后，武则天退位。后世评价既讨论其政治作为，也讨论统治中的暴力与代价；本报告不把权术或伤害他人包装成读者优点。",
          },
        ],
        sourceNote:
          "人物与纪年据《旧唐书》卷6；引句为史家叙述，第二句指高宗与武后并称，非武则天自称或读者标签。御案画面为艺术化，不伪造诏令批语。",
      },
      lifespan: "唐周时期历史人物",
      courtesyName: "名曌 · 武周皇帝",
      sourceKind: "documented-historical",
      quotes: [
        {
          id: "wu-zetian-文史",
          text: "后素多智计，兼涉文史。",
          source: "《旧唐书》卷6·则天皇后本纪（史家叙述）",
          sourceUrl: "https://zh.wikisource.org/wiki/舊唐書/卷6",
        },
        {
          id: "wu-zetian-二圣",
          text: "当时称为“二圣”。",
          source: "《旧唐书》卷6·则天皇后本纪（史家叙述，指高宗与武后并称）",
          sourceUrl: "https://zh.wikisource.org/wiki/舊唐書/卷6",
        },
      ],
    },
    copy: {
      opening: [
        "从一份章奏、一项决定，走近武则天的历史处境。女皇是身份，不是对阅读者的性格判词。",
        "这一卷谈具体选择中的声音、条件与影响，保留人物历史的复杂性。",
      ],
      echo: "一项决定值得被说清，也值得回看它牵动了谁。",
      historyIntro: "宫廷、称帝与退位，构成不可抹平代价的历史过程。",
      historySources: [
        {
          label: "《旧唐书》卷6·则天皇后本纪",
          url: "https://zh.wikisource.org/wiki/舊唐書/卷6",
        },
      ],
      whyByTopic: {
        exploration:
          "阅读武则天，可以在熟悉的女皇形象之外继续认识具体史事。你对新方向与已有经验的选择，可与这种查问细节的阅读相照，不由政治成就推断你的开创能力。",
        voice:
          "处理政事需要让意见进入具体议题，也会牵动他人。你在主张与协调之间的选择，可以借此关注理由是否说清、对方能否回应，不把强势或控制当作成熟。",
        care: "历史决策的影响常涉及许多人，这让处境与代价值得分别看。若本轮支持关照他人的具体主题，可把注意力落在确认需要上，不把统治方式映射为你的共情能力。",
        action:
          "章奏与决定提醒行动需要信息和边界。你先准备还是先推进的选择，可据此问哪些条件已经清楚、哪些影响需要确认，不能借女皇身份为冒进或伤害背书。",
        change:
          "政治制度与日常活动不是同一尺度。这里仅借多环节相互牵动的视角，回看活动安排需要保留什么、改变什么，不把历史权术变成生活建议。",
      },
      neutralWhy: [
        "可以先把女皇的称号放回历史，认识一项政事发生时的条件。",
        "不必从相逢结果认领强势、野心或领导力；具体选择仍要分别看。",
      ],
      closing: [
        "愿你的决定有理由，也有可以回看的余地。",
        "下次先写清一项决定会影响谁，再确认需要补充哪条信息。",
        "落笔有思，行事有界。",
      ],
    },
    resourceRefs: qianzaiKnownRoleArtRefs("wu-zetian"),
  },
  {
    profile: {
      ref: {
        productId: "qianzai-tongxin",
        id: "wang-zhaojun",
        version: "3.0.0",
      },
      displayName: "王昭君",
      honorific: "昭君",
      identitySubtitle: "从出塞的历史，走近王昭君。",
      tags: ["出塞", "关山", "远行"],
      posterTagline: "关山有路",
      posterTags: ["出塞", "关山", "远行"],
      invitation: "为陌生的路，留一项可以确认的准备。",
      baseLines: [
        "愿你走向远处时，也记得照顾眼前。",
        "把需要的支持，一项一项说清。",
      ],
      closureLines: ["关山有路", "来日可问"],
      history: {
        title: "人物小传 · 王昭君",
        timeline: [
          {
            title: "姓名与出塞",
            text: "《汉书》记载汉元帝时，王昭君被赐予呼韩邪单于，成为和亲关系中的人物。记录提供基本事件，本报告不在缺乏依据时替她写出主动请行的内心独白。",
          },
          {
            title: "边塞与关系",
            text: "昭君出塞发生在汉与匈奴关系的历史背景中，其号为宁胡阏氏。她既是具体的人，也处在两方政治关系里，不宜只用一个美人传说替代这些条件。",
          },
          {
            title: "后世意象与边界",
            text: "后来的诗画常把琵琶、关山与昭君联系起来，这些意象可以作为后世接受史来理解。本报告不据后世画面断言她精通琵琶，也不把落雁传说写成史实。",
          },
        ],
        sourceNote:
          "基本身份据《汉书》卷94下，姓名采用常用写法；引句为史家叙述，不是本人自述。出塞驻马为艺术构图，不确证主动志愿、琵琶技艺或落雁传说。",
      },
      lifespan: "西汉历史人物",
      courtesyName: "史载王嫱，字昭君 · 宁胡阏氏",
      sourceKind: "documented-historical",
      quotes: [
        {
          id: "wang-zhaojun-昭君",
          text: "元帝以后宫良家子王墙字昭君赐单于。",
          source:
            "班固《汉书》卷94下（史家叙述；所据文本姓名作王牆，转为简体）",
          sourceUrl: "https://zh.wikisource.org/wiki/漢書/卷094下",
        },
        {
          id: "wang-zhaojun-宁胡",
          text: "王昭君号宁胡阏氏。",
          source: "班固《汉书》卷94下（史家叙述）",
          sourceUrl: "https://zh.wikisource.org/wiki/漢書/卷094下",
        },
      ],
    },
    copy: {
      opening: [
        "先从关山与出塞的记载，认识王昭君。远行的画面里，有个人处境，也有不能忽略的历史关系。",
        "这一卷不替人物补写心声，也不由她的经历预告你的未来。",
      ],
      echo: "远处的风景可以引人停留，具体的准备同样值得被看见。",
      historyIntro: "从史书记载与后世意象之间，分清可知与想象。",
      historySources: [
        {
          label: "班固《汉书》卷94下·匈奴传",
          url: "https://zh.wikisource.org/wiki/漢書/卷094下",
        },
      ],
      whyByTopic: {
        exploration:
          "出塞故事让陌生之地进入视野，但历史远行与日常尝试的代价并不相同。你对尝新或熟悉领域的选择，只借这一画面回看自己的范围与准备，不被要求走向远方。",
        voice:
          "和亲涉及多方关系，不能据此规定个人应当让步。你在坚持偏好与协调安排之间的具体选择，可以借这个距离提醒自己把意愿、条件和可商量之处说清。",
        care: "认识昭君时，先为未知的个人感受留出位置。若本轮具体选择涉及倾听，也可把这份克制带进交谈：询问而非代替对方解释，不由故事推断你更懂他人。",
        action:
          "驻马整理行装是艺术构图，不是对历史动作的复原。它可与一次起步前的准备并读，提醒行动与检查都有位置，仍由现实任务的代价决定先后。",
        change:
          "历史远行无法等同于一次活动变更。这里只借路途与行装的关系，回看安排中哪些主体要保留、哪些步骤可重组，不把适应陌生环境当作已证实的能力。",
      },
      neutralWhy: [
        "可以把关山当成一幅可阅读的画面，同时记住史料没有说出的部分。",
        "不必把远行、牺牲或思乡认领为自己的经历，先留下愿意继续了解的问题。",
      ],
      closing: [
        "愿远处有可问的路，眼前有可用的支持。",
        "下次面对陌生安排，先确认一件需要准备的事与一个可以求助的人。",
        "关山有路，来日可问。",
      ],
    },
    resourceRefs: qianzaiKnownRoleArtRefs("wang-zhaojun"),
  },
  {
    profile: {
      ref: {
        productId: "qianzai-tongxin",
        id: "cai-wenji",
        version: "3.0.0",
      },
      displayName: "蔡文姬",
      honorific: "文姬",
      identitySubtitle: "从音律与缮书，认识蔡文姬。",
      tags: ["文史", "音律", "记忆"],
      posterTagline: "书中有声",
      posterTags: ["文史", "音律", "记忆"],
      invitation: "把值得留下的话，写得清楚一些。",
      baseLines: [
        "愿你珍惜知识，也留意说话时的分寸。",
        "让一段文字，成为可以再次翻看的地方。",
      ],
      closureLines: ["书中有声", "纸上可寻"],
      history: {
        title: "人物小传 · 蔡文姬",
        timeline: [
          {
            title: "蔡琰与才学",
            text: "蔡文姬名琰，字文姬，是蔡邕之女。《后汉书》记其博学、有才辩且通音律，为认识她提供了才学与表达的入口。",
          },
          {
            title: "乱离与归汉",
            text: "史传记蔡文姬在汉末战乱中被掳，后来由曹操派人赎回。这样的经历涉及分离与处境，本报告保留必要背景，不把苦难当作她的全部身份，更不映射为读者经历。",
          },
          {
            title: "记忆与缮书",
            text: "《后汉书》记她回答父亲旧藏书籍的情况，并据记忆缮写篇章。书中也收录其诗作；《胡笳十八拍》的后世归属问题不在这里当作已确定的本人创作。",
          },
        ],
        sourceNote:
          "基本事实与引句据《后汉书》卷84，两条均为史家叙述。缮书动作是艺术化呈现，不作记忆能力测试；不以胡笳意象断言乐器技能，不将乱离经历投射给读者。",
      },
      lifespan: "汉末诗人、历史人物",
      courtesyName: "本名蔡琰 · 字文姬",
      sourceKind: "documented-historical",
      quotes: [
        {
          id: "cai-wenji-音律",
          text: "博学有才辩，又妙于音律。",
          source: "范晔《后汉书》卷84（史家叙述）",
          sourceUrl: "https://zh.wikisource.org/wiki/後漢書/卷84",
        },
        {
          id: "cai-wenji-缮书",
          text: "于是缮书送之，文无遗误。",
          source: "范晔《后汉书》卷84（叙蔡文姬凭记忆缮书，史家叙述）",
          sourceUrl: "https://zh.wikisource.org/wiki/後漢書/卷84",
        },
      ],
    },
    copy: {
      opening: [
        "从一段音律、一页缮写的文字，走近蔡文姬。才学与表达，是这份人物介绍选择展开的入口。",
        "历史中的乱离需要被尊重，也需要与读者今天的生活分开。",
      ],
      echo: "留住一页文字，也为再次理解留下一处起点。",
      historyIntro: "才学、历史处境与缮书记载，让人物不限于苦难叙事。",
      historySources: [
        {
          label: "范晔《后汉书》卷84·蔡文姬传",
          url: "https://zh.wikisource.org/wiki/後漢書/卷84",
        },
      ],
      whyByTopic: {
        exploration:
          "音律与文史让知识有不同的入口。你在熟悉领域继续深入或接触新方向的选择，可以与这种多种学习材料并读，不把历史才女的成就算作你的能力。",
        voice:
          "史传中的才辩与文字提供了表达的侧面。你如何说清自己的方向、如何回应他人意见，可以据此关注措辞和沟通条件，不把能言或沉默固定成一种人格。",
        care: "认识乱离中的人物，需要尊重没有被完整记录的感受。若本轮支持倾听主题，可把这一读法化成询问需要的提醒，不将人物的悲痛或坚忍套在你身上。",
        action:
          "缮书记载把知识落实到具体篇章和纸笔。你在准备与先做一步之间的取舍，可借此问哪些材料已具备、哪一小步可以开始，不能由记忆故事推断你的智力或执行能力。",
        change:
          "篇章需要被保存，也需要有便于阅读的次序。日常活动的保留与重排可借此关注主体与组织，但整理文字的比照不改变第五轴只谈活动安排的边界。",
      },
      neutralWhy: [
        "可以先读一段音律与缮书的记载，不急着为自己寻找同样的遭际。",
        "人物经历并非你的标签；留下一句愿意再读的话，就已是这次阅读的收获。",
      ],
      closing: [
        "愿值得留下的话，有再次翻看的地方。",
        "今天可以记下一个刚理解的细节，之后再用自己的话解释一次。",
        "书中有声，纸上可寻。",
      ],
    },
    resourceRefs: qianzaiKnownRoleArtRefs("cai-wenji"),
  },
] as const satisfies readonly {
  profile: QianzaiClassicalRoleProfile;
  copy: {
    opening: readonly [string, string];
    echo: string;
    historyIntro: string;
    historySources: readonly { label: string; url: string }[];
    whyByTopic: Readonly<
      Record<"exploration" | "voice" | "care" | "action" | "change", string>
    >;
    neutralWhy: readonly [string, string];
    closing: readonly [string, string, string];
  };
  resourceRefs: ReturnType<typeof qianzaiKnownRoleArtRefs>;
}[];
