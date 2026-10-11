# P1 A 流：内容合同与媒体实现

2026-10-12。工作区 `codex/p1-content-media`，基于冻结提交 ecf0b05，并接入总控共享合同 360b9c0。独占内容/manifest/引用/兼容/媒体/fixture；不改 F1、UI、包依赖或 B 流。

## 内容里程碑与 B 接口

`manifest.ts` 导出 `QuizPackManifest`、`parseQuizPackManifest`、`getQuizPackManifestJsonSchema`；`content.ts` 导出 `QuizPackContent`、`ContentReference`、`parseQuizPackContent`、`getQuizPackContentJsonSchema`。均使用 Zod strict，结构失败只输出固定消息，不包含输入值。JSON 字节/深度/重复键由 B 在解析前处理。

manifest 字段：`schemaVersion: quizpack.v1`、`packId`、`packVersion`、`productId`、`contentSchemaVersion: quizpack-content.v1`、`engine: {id,version}`、`components: [{id,version,propsSchemaVersion}]`、`files: [{path,mediaType,bytes,sha256}]`。files 包含 content.json 及全部 assets，不包含自身。

content 顶层：`schemaVersion`、`kind: synthetic|authored`、`product.productId/slug/title/categoryId/tags`、`contentVersion/visualVersion/reportVersion/resourceVersion/componentVersion`、`engine`、`dimensions/questions/rules/results/reportTemplates/layouts/resources`。engine ID 为 dimensions/archetype，version 1.0.0。所有 definition/ref 为 `{id,productId,version}`；content 实体固定 contentVersion，报告固定 reportVersion，资源固定 resourceVersion，组件固定 componentVersion。visualVersion 固定整个 layouts 配方快照，不存在可变视觉记录引用。

问题 options 使用 `contributions: [{dimensionRef,value}]`，每项有限整数且完整维度向量。rules 两分支均固定 sum、linear-to-0-100（bounds 的 min/max 精确等于每题可选贡献累加极值）、result-order。dimensions profiles 使用完整 inclusive 0..100 ranges；archetype 使用 squared-euclidean 与完整 0..100 targets。resultOrder 和 profiles 覆盖全部结果恰一次。这里只检查声明，不执行评分、可达性或见证。六状态 layouts 每个都有 component 三元组、封闭 props（heading/body/density/showProgress）、resourceRefs。

结果使用 portraitRef、reportTemplateRef、完整 witness.answers；reportTemplates 只接受 DETERMINISTIC，包含 title/summary/strengths/tensions/reflection/disclaimer 完整 baseline 与 component。resources 为精确 path/MIME/bytes/SHA/width/height/purpose，含本 Product 所有权、来源/商用与再分发许可声明和 pending/approved 声明。许可与审核字段始终只是 claims；技术检查不授予商业许可或人工批准。

builder 从 content.product.productId/schemaVersion/engine 和所有 layouts/reportTemplates.component 提取 manifest 身份/合同；组件三元组去重后精确闭合，不能增加未知或未使用合同。资源从 content.resources 取得显式路径与声明；actual bytes 必须匹配，不改写 content。manifest.content.json 的字节/hash 由 B 对其实际 canonical JSON 计算，fixture.contentBytes 只对应 fixture 自己的 JSON.stringify 字节。

`validateContentReferences(manifest,content,targetProductId)` 返回稳定 PackIssue[]，核验 Product/schema/engine 一致、精确版本/所属、ID/向量/结果/见证完整、manifest components 与实际引用闭合、manifest files 与资源闭合。B 另核验实际 archive entries/bytes/hash。

`checkCompatibility(manifest,policy)`、`DEFAULT_COMPATIBILITY_POLICY` 仅表示理解合同，不表示组件注册或可渲染。默认六组件为 folio-cover/question/resume/report/poster 和 cabinet-result，version/propsSchemaVersion 1.0.0。

`fixtures/synthetic.ts` 导出 `createSyntheticFixture(engine = archetype)`，返回 `{content,contentBytes,manifest,assets:[{path,bytes}]}`；两个不同 Product 各自具备两题、两维度、三结果及 PNG/JPEG/WebP。运行时 sharp 生成原创合成像素，无大二进制入 Git，不是商品题库或正式视觉素材。

## 验证与限制

内容里程碑：53 项相关单测通过；pnpm format:check、pnpm lint、pnpm typecheck 通过。媒体部分继续在本分支完成；完整包 ZIP、IO、CLI 由 B 实现，六项集成检查与独立审查由总控串行执行，本分支不占用 3100。未实现 DB、导入、发布、评分或渲染。
