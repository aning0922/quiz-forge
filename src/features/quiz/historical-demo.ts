export const historicalDemoStorageKey = "quizforge.d1b.historical-demo.v1";
export const historicalDemoVersion = 1;

export type HistoricalDemoQuestion = {
  id: string;
  prompt: string;
  note?: string;
  options: string[];
};
export type HistoricalDemoProgress = {
  version: number;
  answers: Record<string, number>;
  updatedAt: string;
};

export const historicalDemoQuestions: HistoricalDemoQuestion[] = [
  {
    id: "pace",
    prompt: "遇到一项没有现成答案的任务时，你通常怎样开始？",
    options: [
      "先确认边界，再列出可执行的第一步",
      "边做边调整，让行动带来线索",
      "先找可信的人讨论，听见不同视角",
      "先留一点时间，等自己想清楚",
    ],
  },
  {
    id: "letters",
    prompt: "一封期待已久的来信迟迟未到。你更可能如何安放这段等待？",
    options: [
      "照常安排生活，不让等待占满一天",
      "主动去核实，也接受事情可能有变化",
      "把心情写下来，等合适的时候再说",
      "找朋友聊聊，把不安说得具体一些",
    ],
  },
  {
    id: "crossroads",
    prompt: "路过岔路口时，同伴们各有主张。你会：",
    options: [
      "提议先看地图和时间，再作决定",
      "选一条最有兴致的路，边走边看",
      "听完每个人的理由，找兼顾的选择",
      "暂时不表态，观察大家真正担心什么",
    ],
  },
  {
    id: "craft",
    prompt: "有人请你协助完成一件需要耐心打磨的作品。最让你在意的是？",
    options: [
      "结构是否稳妥，经得起反复检验",
      "有没有留下鲜明而自由的个人表达",
      "合作过程是否让每个人都能投入",
      "成品能否安静地陪伴很久",
    ],
  },
  {
    id: "disagreement",
    prompt: "一次讨论变得尖锐，你发现自己不同意多数人的结论。你会怎么做？",
    options: [
      "说明证据和推理，也愿意修正自己",
      "直接说出直觉，看看它能否打开新角度",
      "先复述别人的观点，避免彼此误解",
      "等情绪平复后，再挑合适时机表达",
    ],
  },
  {
    id: "morning",
    prompt: "清晨多出一小时空闲，你更愿意把它给什么？",
    options: [
      "整理计划，让接下来几天更从容",
      "去一处没去过的地方走走",
      "给久未联系的人写一段真诚问候",
      "读几页书，或者什么也不做",
    ],
  },
  {
    id: "responsibility",
    prompt: "当团队里一件重要事情没人接手时，你通常会：",
    options: [
      "把任务拆开，约定清楚的推进方式",
      "先接下来，之后再寻找更合适的分工",
      "询问大家各自的困难，促成共同承担",
      "确认自己是否有余力，再给出承诺",
    ],
  },
  {
    id: "gift",
    prompt: "如果要为朋友准备一件礼物，你更看重哪一种心意？",
    options: [
      "实用，能在需要时真正帮上忙",
      "意外，让人一看就会笑出来",
      "贴近对方的经历与记忆",
      "不过分张扬，却能陪伴很久",
    ],
  },
  {
    id: "rain",
    prompt: "旅行途中下起了雨，原定安排被打乱。你会：",
    options: [
      "迅速换成室内方案，保留节奏",
      "把雨当成新的风景，临时改变路线",
      "照顾同行者的感受，再一起决定",
      "慢下来，看看雨停后再出发",
    ],
  },
  {
    id: "learning",
    prompt: "面对一门陌生技艺，什么最能让你持续投入？",
    options: [
      "看见清楚的进步路径",
      "不断试出属于自己的方法",
      "和同伴互相鼓励、彼此启发",
      "它能让我更理解自己与世界",
    ],
  },
  {
    id: "promise",
    prompt: "你答应别人一件事，却发现它比预想困难许多。你会：",
    options: [
      "及时说明现实限制，重新约定可完成的范围",
      "咬牙先做，必要时再寻求支援",
      "请对方参与选择，避免单方面承担",
      "安静补足准备，等有把握再回复",
    ],
  },
  {
    id: "farewell",
    prompt: "告别一段重要经历时，你最愿意留下什么？",
    note: "请想象这是一段很长、值得反复回看的经历：无论它曾带来成就、遗憾、友谊或独处，你希望自己在多年以后仍能从留下的东西里读到怎样的诚实与温度？",
    options: [
      "一份条理分明、能让后来接手的人迅速理解前因后果的整理与交代",
      "一个带着不确定性却足够大胆的新开始，让这段经历成为下一次出发的底气",
      "与同路人共同留下的照片、信件和只有彼此才能理解的漫长记忆",
      "一段不必立刻给别人看的自述，让自己在以后任何迷茫的时刻都能慢慢回看",
    ],
  },
];

export function readHistoricalDemoProgress(
  raw: string | null,
): HistoricalDemoProgress | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid saved progress");
  }
  if (!parsed || typeof parsed !== "object")
    throw new Error("Invalid saved progress");
  const value = parsed as Partial<HistoricalDemoProgress>;
  if (
    value.version !== historicalDemoVersion ||
    !value.answers ||
    typeof value.answers !== "object" ||
    Array.isArray(value.answers) ||
    typeof value.updatedAt !== "string" ||
    Number.isNaN(Date.parse(value.updatedAt))
  )
    throw new Error("Invalid saved progress");
  const answers = value.answers as Record<string, unknown>;
  for (const [id, answer] of Object.entries(answers)) {
    const question = historicalDemoQuestions.find((item) => item.id === id);
    if (
      !question ||
      !Number.isInteger(answer) ||
      (answer as number) < 0 ||
      (answer as number) >= question.options.length
    )
      throw new Error("Invalid saved progress");
  }
  return {
    version: historicalDemoVersion,
    answers: answers as Record<string, number>,
    updatedAt: value.updatedAt,
  };
}

export function historicalDemoAnsweredCount(answers: Record<string, number>) {
  return Object.keys(answers).length;
}
