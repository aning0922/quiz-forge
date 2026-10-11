# report

规划拥有 ResultProfile、ReportTemplate、QuizReport，以及网页结果和海报模板。接受确定性评分 DTO 和固定版本，保存不可变快照；重复查看不重新评分。

支持 DETERMINISTIC、COMPOSED、AI_ENHANCED 三种模式的提案类型。可选 AI 只增强已确定结果文案，唯一任务、完整基线回退、最终一次封存；历史查看不请求模型。详细边界见 `docs/REPORT_MODES.md`。

D0 没有真实报告、图表、海报导出或快照持久化。
