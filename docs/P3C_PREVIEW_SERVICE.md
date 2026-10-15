# P3-C A 实施证据

2026-10-16，基于冻结共享合同 c3fdd8ce5d9b8ea0f5763ae9d961f4a161c79494，分支 codex/p3c-preview-service。

## 里程碑一：授权与固定 source

已实现独立 POST CSRF + studio:read，只调用既有 read 三参数；不接写能力、withStudioWrite 或写 UNKNOWN 语义。固定 revision 正文/asset-set 先核有界实际字节、SHA、规范 JSON、严格内容与完整引用，再核 exact product_asset 声明与 blob 元数据。资源 resolver 只取固定 asset-set 与精确一项资源，不取正文/evidence，不要求 alias 首来源等于本 revision 的 source_validation_id。入口和临时评分服务接冻结 PreviewProjection DI；完整 JSON 成功封套经共享 Schema 与字节预算核验，发布前新事务重新授权。

实际检查：新增 repository 单测 9 通过；自有端口 55421、purpose=test 隔离 PG（instance b03fce54a628fb595397f6cb35d78e07）新增服务/来源测试 7 通过。PG fixture 使用真实候选构造与事务，但媒体 evidence 明确为 synthetic、无文件，不代表 native 媒体验证。覆盖 read-only、不更新 idle expiry、固定 revision/完整 Ref、合法 alias、当前 session 撤销/operator 禁用、CSRF 与 hash 先于 projection、v1 原文仍可读。

类型检查、变更范围 ESLint、Prettier 与 diff 检查通过。尚未接 B 真实投影、真实 API 组合；未执行完整构建/E2E/视觉验收。资源文件/共享锁/取消和 server owner 证明属于下一里程碑，尚未宣称完成。
