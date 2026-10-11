/** Neutral art direction only. Rooms follow question position, never option values. */
export const galleryRooms = [
  {
    name: "青玉门庭",
    chapter: "入馆",
    line: "推门而入，循着你的第一念。",
    alt: "青玉拱门层层展开，晨光落在无字册页与铜灯旁。",
  },
  {
    name: "暖灯书室",
    chapter: "观心",
    line: "灯下的问笺，等待你的回应。",
    alt: "暖金纸灯照亮朱红藏架和空白册页，展室里没有人物。",
  },
  {
    name: "听雨回廊",
    chapter: "照影",
    line: "雨落回廊，听见选择的回声。",
    alt: "雨蓝庭院与竹影映入圆窗，近处是安静的展台和灯。",
  },
  {
    name: "星穹内藏",
    chapter: "留记",
    line: "最后几页，留给此刻的自己。",
    alt: "靛夜星穹下的内藏室，中央展台放着尚未开启的无字藏册。",
  },
] as const;

export const galleryStorageNamespace = "cabinet-exploration";

export const galleryQuestionLabels: Readonly<Record<string, string>> = {
  pace: "起念",
  letters: "候信",
  crossroads: "歧路",
  craft: "成器",
  disagreement: "异见",
  morning: "闲时",
  responsibility: "担事",
  gift: "赠礼",
  rain: "遇雨",
  learning: "新知",
  promise: "践诺",
  farewell: "留记",
};
