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

内容里程碑：53 项相关单测通过；pnpm format:check、pnpm lint、pnpm typecheck 通过。媒体已完成，内容/媒体里程碑当时内容/媒体/限额 102 项单测通过；完整仓库 287 项单测通过（补丁结果见下文）。完整包 ZIP、IO、CLI 由 B 实现，六项集成检查与独立审查由总控串行执行，本分支不占用 3100。未实现 DB、导入、发布、评分或渲染。

## 媒体与状态能力收口

`inspectImage(bytes,expected,context)` 接收共享 ImageInspectionContext 的 signal 与已下调有效限额，仍独立拒绝提高/非法限额。expected 可为包含额外资源声明字段的对象，但只读取 ImageDeclaration 字段；快照 bytes/声明/limits 后等待原生解码。父进程先验证 bytes/hash、扩展名/MIME/magic、声明尺寸/像素及动画标记；PNG acTL/fcTL/fdAT 与 WebP 动画 chunks/flags 显式拒绝，避免 decoder 只看默认帧。原始字节通过 stdin 送入固定本地 media-worker.mjs，不传包内路径或网络 URL，不继承 NODE_OPTIONS 等环境配置。

worker 使用 sharp 0.35.5 的 failOn:warning、limitInputPixels、animated:true，先核对真实 metadata，再执行原尺寸 raw().toBuffer() 完整解码并核对实际像素输出。不用 metadata 或缩略图代替解码，不转码产物。父进程核对有界 stdout 协议、真实格式/宽高和声明一致。原生 stderr/异常/输入内容不输出为 issue。

模块内串行原生 decoder；单媒体 deadline 从调用开始覆盖快照和排队。上游取消或 deadline 后 SIGKILL，并等 child close（exit 与 stdio 已闭合）后返回与释放队列。排队取消移除 waiter，不生成 worker；下一个任务可继续。spawn/协议/超大输出失败同样关闭管道并回收进程。未使用临时媒体文件。

六状态能力现已固定 P1_STATE_COMPONENT_CONTRACTS：cover→folio-cover，question→folio-question，resume→folio-resume，result→cabinet-result，report/reportTemplate→folio-report，poster→folio-poster；全部 version/propsSchemaVersion 1.0.0。即使可信兼容 policy 接受某组件，用错状态仍由 references 拒绝。这是合同能力检查，真实组件注册和渲染仍属 P3 未验证项。

已知限制：子进程不等于 OS 沙箱，没有 RSS 硬限额或系统级网络隔离；离线接口不提供任意文件路径、URL、源码或可执行包内容。远端上传开放前须补 OS/container 资源隔离。静态图片成功不声称不存在任意非执行元数据载荷。资源 license/approval 仍为 claims，不授 import/publish。归一化/范围/距离/平分与见证都只是声明；P3 必须实现并验证确定性算术、实际覆盖与见证可达性，不能把当前结构通过当作评分正确。

最终 A 流验证：pnpm format:check、pnpm lint、pnpm typecheck、pnpm test 全部通过。未运行 build/生产 E2E，不占用 3100；阶段六项集成检查、Linux CI 和 Astra 独立审查由总控记录。工程成功不替代授权/人工内容视觉审核，candidate 不能导入或发布。

文本安全约束使用无 transform 的可导出 regex：非空白、无 HTML 尖括号/控制符、无网络/文件/data/javascript 协议和协议相对 URL。JSON Schema 的 allOf 明确包含这些 pattern，相关拒绝/允许用例验证了导出规则与运行时一致；有效前后空格保留，不静默修正字节。JSON Schema 仍不代替跨实体 references、真实文件完整性和媒体解码。

## 媒体 deadline 防御补丁

2026-10-12，继 78dc915 后的小型增量。deadline 使用 node:perf_hooks 的 performance.now() 单调时钟，避免系统墙钟调整。timer 只负责触发取消和 kill；排队获准、真正 spawn 前、child close 和解析成功返回前均显式比较绝对 deadline（到期即拒绝）。无需 spawn 已到期时直接 MEDIA_TIMEOUT；已启动任务仍等待 child close 后返回。外部 signal 已取消时优先 MEDIA_CANCELLED。父进程事件循环阻塞期间无法立即执行 kill 的系统限制仍存在，恢复后不会把晚到成功证据当作按时成功。

核对 [sharp 官方 block/unblock API](https://sharp.pixelplumbing.com/api-utility/#unblock) 与固定 0.35.5 的类型及原生 loader 表后，worker 在接收数据前阻止 VipsForeignLoad，仅开放 VipsForeignLoadPngBuffer、VipsForeignLoadJpegBuffer、VipsForeignLoadWebpBuffer。此为 libvips 操作级加载器白名单，叠加父 magic/MIME/扩展名和 worker metadata 白名单；不等同 OS 文件/网络/内存隔离。原尺寸完整解码、failOn:warning 和 kill/reap 保持。

新增 7 项可控单调时钟/protocol 测试，不靠 1ms 真机 deadline 复现 timer 延迟：同步处理过期、acquire yield 后过期、spawn 前过期、晚到 close、成功解析期间过期、取消优先、排队 grant 过期。另 2 项真实 worker 测试绕过父 magic，确认正常可解析的 TIFF/SVG 由库级 loader 限制先行拒绝；已有 PNG/JPEG/WebP、损坏像素、动画和回收测试继续执行。相关单测共 111 项（内容/媒体/共享限额）；完整仓库单测共 296 项。补丁 format:check/lint/typecheck/test 均通过，不改共享合同、B 流或依赖。
