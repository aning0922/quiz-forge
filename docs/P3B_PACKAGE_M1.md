# P3-B package M1 实现交付

2026-10-16。基线为 P3-A `0059175`；先接冻结合同 `f79e7e4` 与共享 package API/compatibility `3f3fff6`。本工作树仅实现包工具 M1，整体阶段出口仍以 [PACK_ADMISSION_P3B.md](PACK_ADMISSION_P3B.md) 为准。

## 实现范围

新增 `src/features/quizpack/package` 受控入口，支持 container `quizpack.v1` × content v1/v2 × synthetic/authored 四组合。manifest/content 形成相关联合后才进入完整引用与媒体检查；声明和显式期望版本不符时拒绝，不修复。authored 枚举仅是合成测试事实，不构成作者或平台批准。

从旧 v1 提取执行与构建骨架；旧入口固定旧 parser、policy、报告身份，仍拒绝 v2。保留 beforeStructure、parsed、propagate 的调用阶段、媒体问题在引用问题之前的顺序，以及固定排序、STORE/DOS 时间/权限、真实输出 ZIP 再验证的行为。旧 no-clobber 文件提交入口及脚本没有改动。

完整引用检查执行一次基础图，再组合 v2 表现图。共享检查接受 manifest 的结构字段，不把 v2 强转为旧 v1。新 collector 将 `ISSUES_TRUNCATED` 作为控制标记，保留上游截断与最终上限溢出；候选有效必须没有业务问题且未截断。旧 v1 的 issues/截断规则保持。

新 context 在读取源及执行 hook 前快照，只接受 targetProductId、signal、向下 limits；额外 compatibilityPolicy、未知字段、访问器和代理均拒绝，不向 readZip 转发自定义 policy。新兼容判断使用共享冻结 profile，固定 v1 组件 1.0.0、v2 组件 2.0.0、props 1.0.0 与两个 1.0.0 引擎。

## 主控接入接口

所有类型沿用共享 `package/api.ts`，该文件和 `package/compatibility.ts` 未修改。

- `validateSupportedQuizPack(source, context, expectedContentVersion)`：第三参必填，完整字面量 `quizpack-content.v1` 或 `quizpack-content.v2`，返回新 v2 报告。
- `buildSupportedQuizPack(input, context, expectedContentVersion)`：同样必填完整版本；显式 v1 输出 ZIP 与旧构建器逐字节一致，报告使用新身份。
- `validateSupportedQuizPackCore(source, context, execution, selection)`：execution/selection 仅供可信代码组合。`parsed(pack, files)` 接相关联合；expected-version 必填完整版本；backend-matrix 仅供后台可信分派，不能从 HTTP/包字段反序列化。
- `parseSupportedManifest(input)`：有界普通 JSON 快照后严格解析两个 manifest 声明版本。
- `parseSupportedPack(manifest, content, selection)`：可信组合用的关联分派；返回 `Result<SupportedParsedPack>`。
- `validateSupportedPackReferences(pack, targetProductId)`：输入已解析的相关联合，返回 `IssueBatch`；基础图一次，表现图追加。
- `getSupportedManifestJsonSchema(expectedContentVersion)`：完整版本必填，输出对应 literal 声明的 manifest Schema；v1 返回原 Schema。供主控未来明确的 `--manifest-content-version v1|v2` 分支使用。

新问题仅使用冻结合同的有限 codes/messages；显式错配为 `CONTENT_DECLARATION_MISMATCH`、path `["contentSchemaVersion"]`，固定 message 为 `Manifest and content must match the expected content schema version.`，没有请求扩展 root 报告注册表。

## 验证与边界

新增 14 项包测试覆盖真实资产四组合、显式版本、混代组件、review envelope 拒绝、manifest 普通快照、完整引用组合、截断传播、输入快照、向下限额、取消/源失败、policy 拒绝与回调顺序。测试 v2 装饰图使用原合成封面像素的独立声明与实际 bytes，未伪造资源文件或授权。

旧 core 与基线原实现执行 180 组差分，逐项比较完整报告、1,340 条 issues 及回调事件；全部一致。差分探针与基线副本仅在忽略的 `.cache/p3b` 内，不提交重复算法。

默认 `quizpack:schema` stdout SHA256 保持 `1142db3b63f7ec5ea5ed90b8b630f324ae948c626e82e93f7c7c6f909d61f38d`。两个旧合成基准包使用其原 fixture packId：dimensions 15,352 bytes，SHA256 `9e377ab8f3fec0dbf28aeccdbbc092c4131b201b9f558be8f3961f759d6f23a0`；archetype 15,266 bytes，SHA256 `3380e32b52d12e223dfbceb77d5079f602ca8f14e68adb80b6fa4bc7d6088076`。旧/新显式 v1 构建结果逐字节相同。

本地 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 均通过。全仓单元测试 104 文件 / 1,330 项通过；包工具、v1 与 content 定向 15 文件 / 299 项通过。构建含 `BUILD_TRACE_OK`，65 traces、0 violations。远端 CI 不在此本地结果中冒称通过。主控负责整体六项闭环；本工作树未运行生产 E2E、未占 3100、未启数据库或运行迁移。

尚未实现本轮 backend/candidate/restore 桥接，也未修改 server/validation、CLI、依赖、DDL、媒体 source inventory 或 fixture groups。旧入口现在经提取后的 package 骨架引用新源码路径，主控集成后需重建并核实 main 与 fixture 的 source/compiled 媒体闭包与实际封存；本地普通图片解码和构建成功不代表隔离后端、视觉或商用审核通过。M1 完成后停止，桥接等待共享 report/identity 与下一次明确分派。
