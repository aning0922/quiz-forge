export const pageStates = [
  "cover",
  "question",
  "resume",
  "result",
  "poster",
] as const;
export type PageState = (typeof pageStates)[number];
export type ThemeId = "historical" | "sins" | "animals";

// D0 briefs only. No approved assets or production page recipes are declared.
export interface ThemeBrief {
  id: ThemeId;
  number: string;
  name: string;
  englishName: string;
  style: string;
  premise: string;
  composition: string;
  resultDirection: string;
  palette: readonly { name: string; color: string }[];
  fonts: string;
  assetPackId: string;
  status: "direction-only";
  states: Record<PageState, string>;
}

export const themes = [
  {
    id: "historical",
    number: "01",
    name: "历史人物匹配",
    englishName: "Echoes of history",
    style: "新中式古风",
    premise: "在历史的回声里，遇见你的性格原型。",
    composition: "留白与纵向卷轴；偏轴人物立绘，印章作为视觉落点。",
    resultDirection: "人物档案长卷：立绘、性格侧写与文化注解分层展开。",
    palette: [
      { name: "宣纸", color: "#F3EBDD" },
      { name: "墨色", color: "#292D29" },
      { name: "朱砂", color: "#A33F32" },
      { name: "青绿", color: "#47665A" },
    ],
    fonts: "标题：授权宋体 / 衬线；正文：系统黑体。字体文件待选型。",
    assetPackId: "historical-v0",
    status: "direction-only",
    states: {
      cover: "卷轴开篇与原创人物焦点",
      question: "横排题干、舒展的墨线选项",
      resume: "书签提示与明确继续入口",
      result: "性格原型人物档案",
      poster: "单幅人物长卷收藏海报",
    },
  },
  {
    id: "sins",
    number: "02",
    name: "七宗罪趣味人格",
    englishName: "Inner awakening",
    style: "暗黑二次元幻想",
    premise: "探索内心的不同倾向，打开你的幻想角色档案。",
    composition: "中央纹章舞台；侧向属性刻度，锐角边框与深浅空间层次。",
    resultDirection: "角色觉醒档案：原创角色卡与可读的多维倾向图。",
    palette: [
      { name: "夜幕", color: "#181522" },
      { name: "月白", color: "#EEE7FA" },
      { name: "紫晶", color: "#B9A0EB" },
      { name: "旧金", color: "#C8AE73" },
    ],
    fonts: "标题：授权展示衬线；正文：系统黑体。数字采用等宽字体。",
    assetPackId: "sins-v0",
    status: "direction-only",
    states: {
      cover: "原创幻想角色与觉醒纹章",
      question: "深色阅读区、属性刻度与选择反馈",
      resume: "存档节点与继续探索入口",
      result: "角色卡、倾向图及娱乐说明",
      poster: "角色收藏卡与倾向摘要",
    },
  },
  {
    id: "animals",
    number: "03",
    name: "动物人格匹配",
    englishName: "Wild little selves",
    style: "可爱卡通",
    premise: "找到和你同频的小动物，收藏一张自己的性格卡。",
    composition: "错落贴纸与收藏卡；角色溢出画框，圆润手绘轮廓。",
    resultDirection: "动物收藏卡：大幅 Q 版角色、生活化侧写与分享短句。",
    palette: [
      { name: "奶油", color: "#FFF4D9" },
      { name: "森林", color: "#33594B" },
      { name: "蜜桃", color: "#F2BAA5" },
      { name: "湖蓝", color: "#A8CFDB" },
    ],
    fonts: "标题：授权圆体；正文：系统黑体。禁止整段使用手写字体。",
    assetPackId: "animals-v0",
    status: "direction-only",
    states: {
      cover: "Q 版原创动物与手绘贴纸",
      question: "大点击区域与轻快选择反馈",
      resume: "收藏书签与继续答题入口",
      result: "可收藏动物角色卡",
      poster: "独立动物卡及性格短句",
    },
  },
] as const satisfies readonly ThemeBrief[];

export function getTheme(id: string): ThemeBrief | undefined {
  return themes.find((theme) => theme.id === id);
}
