# quizpack

核心生产入口：Codex 精品研发 → 标准化 .quizpack → 验证 → 导入 → 预览 → 人工审核 → 发布。

`contracts.ts` 保留 D0 完整包提案；F1 的 `foundation.ts` 独立提供有限运行时结构、归属和引用验证，并生成 JSON Schema。参考包与细节见 `foundation.md`。F1 总是返回 publishable=false；没有 ZIP 解析、完整包构建、导入、数据库业务或执行包能力。局部结构合法不代表可发布或导入安全。

未来负责容器/结构/兼容/引用/规则测试/安全校验与导入草稿，通过各领域接口组装固定商品版本。禁止执行包内 JS/TS；专属 React 组件只能在主工程中经过审核后通过受控注册表引用。
