# P4 消费者显示接口准备

本步从 P3-E `c83788b` 接续共享 `5916516`、`6b5b4ef`。目前只交付纯显示 props/回调接口与下列文件计划；尚无 consumer 组件、服务器投影、PNG、持久化 host、业务 HTTP 或浏览器验收。不以接口准备声称保存、恢复或完成已实现。

`interfaces.ts` 只依赖 React 类型与稳定的 display-v1。它不接受 raw Key、grant、Cookie、CSRF、operation key、数据库对象或完整评分源。显示组件不发送请求、不评分、不保存答案。调用方必须先验证 source/play/runtime 的精确绑定、获权内容及服务器事实；类型本身不授予这些权威。

## Props 与回调边界

- cover/question/resume 使用 `DisplayEntryBodyV1` 和显式保存呈现状态。`saved` 必须由已核验服务器 state/receipt 提供，没有默认成功状态。
- 修改答案及游标的回调统一放在 enabled controls 中。saving、UNKNOWN、conflict、失权或不可用时，只提供 blocked controls，不附编辑回调。实际 host 仍须同步撤销授权代次并拒绝迟到动作；显示类型不能代替这一控制。
- question/resume 的完成回调只打开完成检查，不直接评分、发送 complete 或将其显示为已完成。
- result/report/poster 只使用已保存的 `ResultDisplaySnapshotV1`。没有返回可编辑答案、重新答题或重新完成的回调；页面切换仅在同一只读快照内导航。
- 媒体由调用方提供已验证的内容、loading 或有限 unavailable 状态。缺图不替换成人物 Emoji、装饰图或其他结果，不接受任意网络地址或异常原文。
- 海报导出状态显式区分 idle/exporting/ready/unavailable。导出或下载动作由 host 提供；生成失败不修改报告，也不触发重新评分。

## 实施文件清单与归属

本目录归 B，拟按以下精确入口实现；本步只创建 `interfaces.ts` 和本文。

| 后续文件                | 职责                                                                            |
| ----------------------- | ------------------------------------------------------------------------------- |
| `components.tsx`        | 六个独立消费者视图，沿 folio/cabinet 配方与既有正文/素材；自身不持有业务权威    |
| `consumer.module.css`   | 独立样式，沿既有排版与视觉，保留移动端/长文案/减少动态效果处理                  |
| `registry.ts`           | 编译组件表及精确六角色检查；核对 root descriptor，不 fallback 旧 preview/latest |
| `projection.ts`         | server-only 中性 entry 与可信评分后的显示投影；无浏览器评分入口                 |
| `renderer-client-v1.ts` | 显式绑定六视图、consumer PNG 与固定字体 descriptor                              |
| `renderer-server-v1.ts` | 显式绑定新服务器显示投影；不发明 source/评分/持久化权威                         |
| `components.test.tsx`   | 实际组件的状态隔离、禁用回调、缺素材及长文案验证                                |
| `projection.test.ts`    | 中性 allowlist、关系/预算/版本失败以及选中结果隔离                              |
| `registry.test.ts`      | 精确 source/runtime 六映射，拒绝错误或缺失实现                                  |

PNG 文件计划见 `features/report/consumer-v1/README.md`。新实现方向为 `consumer-folio-cabinet@1.0.0`，source tuple 保留既有六 ID / `2.0.0` / props `1.0.0`；六个新 runtime ID 均以 `consumer-` 开头且互不相同。具体 tuple、entry SHA、能力登记及闭包摘要由 root 生成/冻结，本步不创建可用身份或修改共享 registry。

## 复用与历史保持

复用 display-v1 的严格正文与关系验证、`lib/browser/display-assets` 的有限字节/hash 读取及 `display-task` 的取消/期限。服务器结果可在可信服务先核固定来源并实际执行精确 engine 后调用原 `projectContentScoreForDisplay`，再转换到新 consumer 边界；历史报告读取只取已保存快照，不再评分或重建文案。

entry 投影必须独立显式挑选题目/选项、中性 cover/scene 及必要 frame，不调用带 Studio scope 的 `preparePreviewContent` 或创建假 `PreviewBinding`。不会将权重、候选报告、未揭晓人物资源或完整 source 带入浏览器。

旧 `theme/preview`、`studio/preview`、`report/preview` 及已封存 descriptor 的字节保持不变。新组件不调用旧 `PREVIEW_COMPONENTS`；临时体验/刷新重置/待审操作提示由消费者自身真实状态文案替代，来源内容和布局 tuple 不改写。

共享业务 Schema、服务 ports、HTTP/controller、Key/session/report 接入等 root/A 合同冻结及本接口审查后再推进。真实 DB、3100 生产 E2E、最终截图/PNG 与持久化验收由总控安排。本步不新增依赖、素材、DB、路由或业务按钮。

## 本步验证

2026-10-18：四个新增文件的 Prettier 检查、两个 TypeScript 接口文件的 ESLint、完整 `pnpm typecheck` 通过；接入的共享 state/identities 两文件共 15 项测试通过。本步没有组件实现，因此未新增镜像单测，也未运行 build、DB、服务、native 或 3100 E2E，不据此声明视觉或持久化已通过。
