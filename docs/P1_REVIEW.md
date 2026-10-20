# P1 独立代码审查

## 结论与范围

2026-10-12（Asia/Shanghai）。非实施审查聊天对 P1 两条实现流进行了分批审查、独立失败复现与修复复核。最终审查落点为 `3a1ad7ad98e6220bd1a26648f4589d42a12950c1`，未发现未解决的 P1/P2。五项已复现 P2 均已闭合。本结论只覆盖 P1 本地包工具，不替代总控六项工程检查、远端 CI、人工内容/视觉/素材批准或发布授权。

正式 origin 为 `https://github.com/aning0922/quiz-forge.git`，分支为 `codex/quizpack-toolchain`。从已审 F1 `efe29e63839597dde557b791d03885e675c660ba` 堆叠开发，不代表已合并 main。

审查覆盖 manifest/content Schema、归属与引用、兼容声明、合成 fixture、资源完整解码、受限 ZIP、限额/deadline、本地 IO、确定性构建、验证报告、三个真实 pnpm CLI 及提交回执。首款内容准备和 P2 预研文档不属于本次 P1 代码验收；没有把其规划或合成内容认定为正式测评。审查聊天只写本文，没有修改实现、依赖或其他文档，没有启动服务器、提交或创建 PR。

## 提交追溯

| 内容                              | 原实现提交                                 | 总控集成/合同                                                  |
| --------------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| P1 范围、接口与限额               | —                                          | `6e4263c`、`360b9c008983495075d689788e942291285a9028`          |
| A 内容合同第一里程碑              | `2d0f9d45`                                 | 集成af24e20；初审树 `c1987025188656dadb91708cfdae9cbc54ce75b1` |
| B ZIP/IO 第一里程碑               | `8599634172c93b20b2984a06fb3891334e53fb51` | 集成fafe098；初审树 `c1987025188656dadb91708cfdae9cbc54ce75b1` |
| A 媒体、文本及状态映射修复        | `78dc9154045118a3ba4f026703111a0a44258518` | `b13a314ba33368177024582a00fb025aaa088f71`                     |
| B ZIP 单调 deadline               | `2e949e823e6dba236e2cdfa38ee0e775e889e239` | `7c8b550c77894c1ff81a030ff6bf3b5882cba71a`                     |
| B 构建、验证与 CLI                | `9c084f5f9affba3132b5fae1f78a80992a26e318` | `ba9632756ba23d0ff74dd2deeceb5f0d65bcc2e2`                     |
| A 媒体单调 deadline 与原生 loader | `89316214279172198873422c222f27cc5a95adf5` | `a1696861ab3cce505cf0674017473e0ef13ccd30`                     |
| 输出提交点决定                    | —                                          | `7080e8f`                                                      |
| B 提交回执与晚到中断              | `ed6e8cf2cf4518cfb9e247978eefd3003caa3078` | `3a1ad7ad98e6220bd1a26648f4589d42a12950c1`                     |

修复复核比较了对应原提交与总控树的相关实现/测试文件，未发现交接差异。yauzl 已移除，最终 ZIP 为项目受限格式扫描与 Node zlib 解压；不能把最初候选依赖描述为最终运行路径。

## 五项发现及闭合证据

以下位置和行为描述对应发现时的旧实现；最终代码已修复。

### P1-R1：P2，ZIP 同步处理越过 deadline 仍成功 — 已关闭

旧 `zip.ts` 的 withPackDeadline 仅靠 setTimeout；立即就绪的输入与同步 STORE/CRC/hash 工作可以阻止 timer 分发，最终清除 timer 后返回成功。

独立构造四个各 7 MiB 的 STORE 条目，archive 为 29,360,550 bytes，CRC/大小/布局正确；以 operationMs=1 读取，旧实现两次分别约 100 ms、96 ms 返回 ok:true。不是无效媒体通过：该复现专门针对容器读取层的期限。

`2e949e8` 加入 performance.now 绝对期限、嵌套信号继承、同步阶段及成功返回前检查，并在批量读取/条目之间让出事件循环。独立重跑同等大小包，两次约 2 ms、1 ms 返回 OPERATION_TIMEOUT；嵌套操作超过原期限也拒绝。新增立即就绪/空块输入、同步越期和嵌套期限测试通过。

### P1-R2：P2，必需文本接受纯空白 — 已关闭

旧 `content.ts` 的公共 text 只检查最小长度。把合法 fixture 的标题、题目及 baseline 标量全部改为 `" \n\t"`，列表改为只含该值时，内容 parse 成功，引用和兼容均返回空 issues。

`78dc915` 增加非空白 regex。独立使用原复现，运行时与导出 Schema 均拒绝；标题、基线和列表元素的拒绝用例已持久化。

### P1-R3：P2，JSON Schema 遗漏 URL 文本约束 — 已关闭

旧 `content.ts` 使用 refine 拒绝 URL，但 toJSONSchema 导出时没有保留该规则，也未因 unrepresentable:throw 报错。把 title 改为 `https://remote.invalid/asset`，运行时拒绝，导出 Schema 的结构验证接受。

`78dc915` 改为可导出的等价 regex，并增加 Schema pattern 对照。独立复测普通 URL、混合大小写及跨行危险协议，运行时与 Schema 均拒绝；合法中文两侧均通过。独立对照使用现有 Ajv 验证双方支持的结构关键字，对克隆 Schema 移除了元标识；这不是完整 Draft 2020-12 实现兼容认证。

同一提交的六状态与报告组件三元组映射亦已复核：cover 使用 cabinet-result、报告模板使用 result 组件均返回 COMPONENT_STATE_MISMATCH。此项由总控先行派修，不计入上述五项独立发现。

### P1-R4：P2，媒体成功回调延迟可绕过期限 — 已关闭

旧 `media.ts` 使用 Date.now 计算初始剩余时间，随后仅依赖 timer；child close 成功处理前没有实际截止检查。

独立探针使用真实 PNG 与真实 worker，仅在其 close 事件中、模块处理成功之前增加 250 ms 同步阻塞。imageMs=150 时，旧实现约 360 ms 返回成功；正常对照约 71 ms 成功，stdout 阶段阻塞对照返回 MEDIA_TIMEOUT。该复现是事件回调延迟边界，不声称普通解码必然超时。

`8931621` 改用 performance.now 绝对期限，在队列授予、spawn 前、close 和成功返回前核验，外部取消优先。原真实 worker/close 阻塞探针重跑：约 323 ms 返回 MEDIA_TIMEOUT，返回时子进程已关闭。34 项媒体测试独立通过，包括七项时钟边界、取消、队列恢复及 kill/reap。

该提交同时在 worker 中先禁用通用原生 loader，再仅放行 PNG/JPEG/WebP Buffer loader；真实 TIFF/SVG 拒绝测试通过。此为防御收口，初审未发现经公开 inspectImage 入口调用其他 loader 的实际绕过，因此不另计安全缺陷。

### P1-R5：P2，已提交产物被晚到取消报告为普通失败 — 已关闭

旧 `writeArchiveNoClobber` 在 link 后检查取消，但临时文件 finally 清理仍可发生在该检查之后。独立使用真实磁盘，在临时文件 unlink 开始时触发取消；外围 withPackDeadline 抛 OPERATION_CANCELLED，目标完整存在。用户若按失败重试会遇到 IO_OUTPUT_EXISTS。

总控通过 `7080e8f` 明确提交点语义：hard link 成功即 committed；处理期限控制提交前工作。提交后晚到取消/超时/cleanup 失败必须如实返回回执与警告，不转换为普通失败、不删除可能已被替换的目标。

`ed6e8cf` 实现绑定实际快照 bytes/hash 的 ArchiveCommitReceipt，IO 与 CLI 共用编排保留回执；外围最终 deadline 抛错时仍返回 committed outcome。新增 12 项测试覆盖取消、超时、cleanup 失败、目标替换、提交前拒绝/清理告警及真实 CLI 共用编排。

独立重跑原取消点，这次使用完整 buildQuizPackFile、真实合成内容/资源与磁盘：返回 ok:true、committed:true，warnings 为 OUTPUT_COMMITTED_CANCELLED；实际文件、回执和验证报告的 archive hash 相同，没有残留临时文件；candidateValid:true 且 importable/publishable:false。目标替换测试确认没有盲删替换文件。

## 最终独立验证

- 在 `3a1ad7a` 执行 `pnpm exec vitest run src/features/quizpack/v1`：8 个文件、200 项测试全部通过，退出码 0，10.11 秒。覆盖最终 P1 全部专项测试，不包括全仓库历史测试。
- 提交回执、IO、CLI 和 validate 四文件另已独立通过 37 项测试；媒体修复单独通过 34 项测试。它们是专项复核，不与 200 项重复累计。
- 真实 pnpm --silent schema/build/check 子进程测试通过：单个 JSON stdout、失败非零、无原文/本机路径回显、文件与 stdin、UTC/Pacific-Honolulu 构建 bytes/report 一致及 no-clobber。
- 构建输入 content/assets、可信兼容 policy 和有效 limits 在异步前建立独立快照；manifest、content 资源声明与实际条目/bytes/hash 三方校验闭合。原声明冲突被拒绝，不静默修复。
- 容器、结构、完整性、媒体、引用、兼容结果区分 passed/failed/not-run，失败不能获得 candidateValid。证据绑定实际 archive/manifest/content hash、目标 Product、validator/policy 及有效限额/兼容 policy hash。
- 媒体父进程校验原始字节 hash、尺寸/格式声明；子进程完整原尺寸 raw 解码，禁止动画，应用限额及原生 loader 白名单。进程环境仅含 NODE_ENV=production，不继承父进程凭据或 NODE_OPTIONS；等待 close 后释放名额。

审查没有运行完整 format/lint/typecheck/test/build/E2E 六项，没有占用 3100、浏览器截图或访问远端 CI。实现聊天报告的全量检查属于其工作树证据，不能冒称总控最终 head 已通过。本文件完成后的格式检查另由本审查执行；总控六项结果、精确 CI 与 Draft PR 由总控在阶段交付记录中补齐。

## 限制与后续接口

- 仅支持 quizpack.v1 的受限 ZIP profile，不兼容任意 ZIP。压缩流、实际大小、CRC 与 hash 检查不等于恶意软件扫描，也不证明图片元数据没有任意载荷。
- P1 是本机离线工具；可信本地来源目录是前提。父路径检查不能替代 OS 对恶意并发文件系统写者的隔离。任意永久阻塞的自定义 AsyncIterable 不能被强制终止，工具只保证自身退出、不等待阻塞 return；Node 流主动关闭。
- 媒体子进程不是 OS 沙箱或 RSS 硬限额。未来开放不可信远端上传前仍需系统级资源与权限隔离。包内字体拒绝；字体以后通过受控注册与授权审核接入。
- 技术检查成功不证明授权、人工内容/视觉正确性、组件实际存在/渲染或评分/见证可达。P1 仅支持 DETERMINISTIC 声明，不实现评分、数据库、正式导入、Key 或发布。
- 输出回执证明对应 hash/bytes 曾成功提交，不保证目标路径此后未被替换，也不声明目录项具备断电持久性。cleanup 失败允许临时 inode 残留并明确告警，不能宣称已清理；调用方不得把 committed warning 当普通失败盲目重试。
- P2 必须在运营授权和目标 Product 边界内重新验证实际字节与当前政策；P3 另产生引擎、可达性和实际组件证据。不得通过修改 P1 报告的 false 字段授予导入/发布资格。

## 交接

独立代码审查完成，五项发现全部关闭，无剩余 P1/P2。待总控完成最终六项检查、实际 CI、提交推送和 Draft PR 后，按已授权托管路线决定 P2 开始条件。main 合并、生产迁移、公开部署和真实商品发布仍保留既定授权与人工决定。
