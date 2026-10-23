# R1 独立合成恢复演练

`synthetic-pack.ts` 从固定 `p4-baseline` 的真实文件构建 ZIP，验证已登记的 content、manifest、asset-set 三项摘要及五张 PNG，保留原 manifest 字节。基线实际为两题、三结果、五资源。构建只证明包检查通过；不签发私有候选、媒体停止证明、数据库历史或批准记录。

后续实际演练须在 B 独占的新 test 实例运行，不能调用 `prepareP4ConsumerSource` / `seedReadyP2b3Source` 的 no-file 快捷种子：

1. 创建独立 operator 和空 `consumer-flow-fixture` Product；通过真实 `createIntent` 与 `receiveArchive` 接收 helper 产生的完整字节，核原包 SHA、长度和 durable stopped 回执。
2. 在匹配当前工作树的已配置媒体运行时上，通过真实编译 Next HTTP 路由调用 `prepareValidation` / `startValidation`。原生运行根由 Next 编译固定，不能从 raw TS 导入执行或注入 globals 来替代。`runtime-recovery-drill-source.ts` 只创建新的合成 test 实例，独占 55422/55428，启动自身 HTTP，结束后验证实际退出。不 mock native media，不直接落账 ready，不伪造 fileStopProof。要求 ready、五资源、全部尝试真实停止并释放；真实 apply、审核及版本封存。
3. 通过业务接口创建一个已完成报告、一个进行中答题和一个未使用 Key。原始合成凭证仅留在自有私有演练状态，不写 Git、截图或公开输出。
4. 源 HTTP、worker 和请求连接由其 owner 实际关闭；禁用导入并关闭 fixture 连接。调用正式备份工具，由 A 检查数据库和文件完整闭合；不能为演练放宽准入。
5. 新受管工作树使用相同逻辑 ID、新数据库密码、新端口恢复。先比较完整数据库指纹和文件清单；目标首次恢复结果必须为 verified-stopped。
6. 独立 browser context 与显式目标配置启动自有目标 HTTP。检查旧报告及资源、继续原进度、完成未使用 Key，遵循真实时钟。源 HTTP 保持停止。新端口本身不隔离 Cookie。
7. HTTP 与目标数据库实际退出后保留现场，记录有限摘要和关闭证明。未知 IO/子进程结果保留且失败，不删除、不覆盖重试。不以 HTTP 验证替代备份时的源/目标指纹相等证明，因为业务验收会产生新的合法目标记录。

B 的文件/能力/CLI 边界测试使用 `vitest.recovery-tools.config.ts`；A 的数据库测试独立位于 `tests/recovery-data/`。原 39eb、原私有资源和 3100 不属于本 fixture。

2026-10-21 B 本地来源前置已实际执行：run `47031d8b-c1e6-4b10-b605-d95c1c5c3d2e`、新 test 实例 `77ff081dd5e79fa80f814fdec4a19ee3`，sourceRecord SHA `fc544097a39db0703274947d848fac9012ee5e78f3c7d31d449341e2275cbb7e`。真实 media main build/setup/provision 已封存，receive/原生验证/应用/审核/版本/play/Key/消费者保存与完成链通过。独立 owner SQL 复核精确 import 1、validation 1、draft 1、revision 1、review 1、version 1、play 1、Key 3、session 2、report 1、blob 5、Product asset 5；SQL 连接实际关闭，HTTP 55428 无监听，源 PG 55422 保留运行且 imports disabled。初选 HTTP 55423 已有 PG listener，脚本在新建任何实例前拒绝，未操作该 listener，随后改用确认空闲的 55428。主控之后确认 55423 属于需保护的原 39eb，继续保持不操作。这仅证明来源准备，不是备份、恢复或目标 HTTP 演练通过；完整恢复证据由阶段验收记录。

后续运行仅对新发合成 Key 使用正式服务支持的 7 天有效期，供独立审查和完整工程检查后演练。当前 77ff 的原 Key 保留原始 1 小时 TTL，不更新记录、不回拨时间；自然过期后可作为负例，正向演练另建来源或通过正式运营服务新发 Key。

保留 77ff 的同时，新来源脚本可显式使用独立监听地址，例如 `--pg-port=55430 --origin=http://127.0.0.1:55431`，仅初始化全新随机 ID 的 test 实例；仍须启动前实际核空闲，不复用未知 listener。默认值保持 55422/55428，已占用时拒绝。参数不允许选择已有实例，并预先拒绝 3100、5432、受保护 55423 和恢复保留 55426/55427；监听探测也立即销毁误连 socket 并实际关闭。此参数准备没有启动新来源或更改 77ff。

恢复后 helper 要求一个全新的私有 `evidenceDirectory`。它让 pending 与 unused 均通过实际 HTTP 完成，前后复核备份前旧报告摘要；通过真实报告页“查看海报 → 生成报告海报 → 下载 PNG 海报”取得实际下载文件，验证 PNG 头、1080×1920、完整解码与摘要。有限产物为旧报告/海报、新完成两份报告的 390×844 浏览器完整截图及原始导出 PNG，均以 0600 保存于私有目录。独立 browser contexts 逐一关闭；源 origin hold 立即销毁误连 socket，并等待 listener/socket 实际 close，未知 close 永久拒绝。若调用者显式提供独立保存的合成 operator 凭证，helper 额外走恢复后台正常 preauth/login/issue 链新发一枚 7 天 Key，只返回有限 receipt 摘要，不输出原始凭证。以上 helper 准备不等于这些目标验收已经执行；实际证据另记。这里的“旧报告”指备份前已存在的报告，当前来源仅覆盖 renderer 1.0.1，不冒称已覆盖 renderer 1.0.0 恢复。

2026-10-21 非空 roundtrip 已实际执行，有限安全记录见 [roundtrip-evidence.json](roundtrip-evidence.json)，完整私有材料保留于源工作树 `.cache/runtime-recovery-drill/e5cc1525-855a-4e6c-a560-0801c4b46ebc/`，不提交原包、dump、source/operator 记录或截图。实际生产 code SHA 为 `1e7551cdfd750ba85f4a6d49ab7a0f76c5483eb2cafc79d93bcc9cf2781475b2`，与主控 `6f8950b` 同字节。真实 CLI backup/verify、两个互不覆盖目标根的 restore 均退出 0；干净目标先返回 verified-stopped，再启动 HTTP。

最终 helper 实际完成旧报告/资源读取、pending 进度匹配并完成、原 unused 完成、后台新发 7 日 Key及实际产品 PNG 下载；Chromium 156.0.8078.4，viewport 390×844。PNG 为 1080×1920、1212033 bytes，SHA `9161c53418360ea841910320c66fc28d6e3322a2262a8cbc641fef5080dea7e9`。独立目标 SQL 为 Key 4、session 3、report 3、grant 8，原报告行 SHA 与源备份一致。源在 HTTP 后再次完整 backup/verify，23 表全部证据、18 项迁移和资源清单与原备份完全相等，仍为 68 行；没有以不调用 dump 的只读 callback 绕过完整快照协议。

先前两轮远程 `download.path()` 拒绝和一轮消费者 CSRF 头错误均保留为失败证据：前者改为真正下载流并限 16 MiB、持有创建任务及真实 end/close、迟到清理永久拒绝；后者实际见证 403/CSRF_REJECTED 后，改用已有消费者专用头常量。错误头轮次的 session/report/Key 全表指纹仍与备份相同，pending revision 仍为 1；仅正常交换的 grant/budget 改变。没有改数据、回滚或延长 TTL 重跑；最后证据目录是新的私有目录。

B 逐张检查五张最终原图；报告正文/指标/只读状态完整，三报告图相同来自同一组合成答案，实际 report ID 各异。海报截图有焦点态 skip link 叠于上部图片，记录为非阻断焦点状态，原始导出 PNG 没有该链接；不修改产品或修饰截图。源 3cf/55430、旧 77ff/55422、失败与干净目标 PG，以及本轮 HTTP/浏览器进程和组全部实际关闭并停库保留，三个媒体 control 均为空。原 39eb/55423 与原 3100 未操作。此记录只交付 B 合成恢复见证，不替代主控完整回归、独立验收、商业批准或整体 R1 交付结论。
