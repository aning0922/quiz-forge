# P3-B 可信桥接接口与首个实现里程碑

2026-10-16。依赖已接入：共享机器合同 `530ede8`（本地副本 `c315f1e`）、0015/guard 与当前 archive.v3 默认 `493598f`（本地副本 `d9d9995`）；package M1 及 hook 修复为 `0edb581`、`09b7731`。依赖副本不是本里程碑的实施交付，主控无需重复 cherry-pick。

## 已实现

- 新 prepared 和 engine 明确调用 `supportedRuntimeIdentity`，生成 identity.v2 / validator2.0.0 / supported policy / report.v2 精确 tuple。
- engine 使用可信 `{ kind: "backend-matrix" }` 调用完整包 core；容器仍 v1，两种 content schema 与 synthetic/authored 四组合均可经真实 ZIP 检查进入后续隔离 inspector。未知 schema、容器版本、目标 Product、结构与文件闭合失败仍拒绝。未从 HTTP/包内容接受 parser、policy、execution 或 selection。
- 新报告使用 `sealSupportedReport`，原严格 v1 报告与 identity 读取分支保留。执行 scope 的中断报告类型改为明确的旧/新联合，不伪称 v1。
- private candidate 继续只从封存报告绑定的原始 manifest/content entry bytes 重解析。原始 JSON hash、文件集合/bytes/hash、相关联合、按 schema 选择的组件矩阵、真实资源 bytes 和已有媒体 facts 均核对；资源副本独立保存。旧身份只允许原 v1/synthetic 候选声明，不为其增授 authored/v2 能力。
- restore 保留同 context 单次 prepared handle、当前身份与原证据精确相等、原 archive SHA/bytes、raw JSON hash、canonical 文本/hash、asset-set、candidate hash、资源数核对及最后 IO/checkpoint 证明。不读取当前 binding、不重跑 decoder、不生成新报告；旧身份证据先返回 `REVALIDATION_REQUIRED`。
- 未验证清单全部保留。authored 值不代表作者审核、版权、评分、渲染或发布批准，importable/publishable 仍 false。

## 供 A 接入的实际接口

`CandidateFacts` 现在为 `DeepReadonly<SupportedParsedPack> & 原有事实字段`，因此新增平面判别字段 `contentSchemaVersion`：

- `facts.contentSchemaVersion === "quizpack-content.v1"` 时，manifest 与 content 一起收窄为 v1。
- `facts.contentSchemaVersion === "quizpack-content.v2"` 时，两者一起收窄为 v2。
- contentKind 从严格 content 的 `kind` 读取，允许 synthetic/authored；事实中没有批准状态升级。
- 原有 canonicalManifestText/hash、canonicalContentText/hash、assetSetText/hash、candidateSha256、resources 等字段与 candidate hash 算法不变。opaque handle / WeakMap 权威不变，JSON/结构复制不能签发 handle。

`ExpectedCandidateFacts` 沿 root 共享类型：container v1，完整 content 版本 v1/v2，kind synthetic/authored。`expectedCandidateFactsSchema` 已与四组合对齐。`prepareValidationIdentity`、`restoreValidatedCandidate`、`serializeEvidenceSqlProjection` 调用签名未变；index 追加新严格报告 Schema、seal 与 hash 的导出，旧导出保留。

`tests/db/p2b3-fixture.ts:268` 目前把可能为 v2 的 facts 展开后替换成 v1 content/manifest，完整 `tsc --noEmit` 只报此处 TS2322。该文件归 A，本流未修改；需先按新的平面判别字段收窄再组成一致的 fixture。不得通过弱化相关联合或强制 cast 形成虚假的绿色结果。root 已把此接入点转交 A。

## 本地证据与待集成项

`pnpm exec vitest run src/features/quizpack/server/validation`：9 文件 / 103 项通过。新测试使用八个实际构建的合成 ZIP（双引擎 × 双 schema × 双 kind），隔离平台 binding/decoder 明确 mock；验证和恢复保持同一原 archive 与所有 raw/canonical/asset/resource hashes，测试私有副本、单次 handle、旧证据只读及恢复拒绝、改事实/身份/投影拒绝。既有停止、取消、清理期限与未知 IO 回归同时通过。

`pnpm format:check` 与 `pnpm lint` 通过，最后修改的 engine/test 也重新执行 ESLint 通过。完整 typecheck 当前受上述 A 文件阻断，不宣称通过。此里程碑只跑自身 pure/bridge 定向；未运行全仓 unit/build、PG、生产 E2E 或真实媒体封存，未启 55422、未占 3100。未修改 root 四个共享 server 合同、CLI、依赖、迁移、全局配置、source inventory 或 fixture 脚本。

主控集成后仍须与 A 业务链联调，并重建 main/fixture 的 source/compiled 媒体闭包、执行真实停止/媒体/DB/浏览器与最终六项检查。独立审查尚未完成；这不是 P3-B 整体退出或素材商用批准。
