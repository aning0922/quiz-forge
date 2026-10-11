# report

规划拥有 ResultProfile、ReportTemplate、QuizReport，以及网页结果和海报模板。接受确定性评分 DTO 和固定版本，保存不可变快照；重复查看不重新评分。

支持 DETERMINISTIC、COMPOSED、AI_ENHANCED 三种模式的提案类型。可选 AI 只增强已确定结果文案，唯一任务、完整基线回退、最终一次封存；历史查看不请求模型。详细边界见 `docs/REPORT_MODES.md`。

D0 没有真实报告、图表、海报导出或快照持久化。

Visual V2-A.1新增只读synthetic图谱DTO、内部展示校验、角色文案DTO和古诗/原创题签联合类型，均由固定fixture驱动；旧D1-A.1文字维度视图保持。当前可显示4–7项0–100模拟刻度、有来源的诗句与海报小标签，但仍没有评分、动态选诗、正式报告、导出或快照持久化。未来评分/匹配/归一化/来源追溯/稳定题签选择仅记录于 `docs/VISUAL_V2_A1_CONTRACT.md`，不冻结QuizPack Schema。
