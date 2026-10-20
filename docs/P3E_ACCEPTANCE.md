# P3-E 精确基线审核与内部版本封存技术验收

日期：2026-10-18。生产运行代码为 `eb7595af569e405b1019c0c876d82f05c246b051`，测试修订为 `f924f23bb74e6982c3d87c815fc48db8301f7d6f`。版本列表 render P2 与测试拦截范围错误均已独立复核关闭；新构建、媒体封存和生产运行提交的双 CI 已通过。第四轮完整生产浏览器已通过；两独立开发聊天各完成 80/80 原图检查，Astra 完成独立出口复核。无剩余 P1/P2，保留三类非阻断后台排版 P3，本阶段技术出口完成。

## 已实现行为

后台对精确 Product、draft/revision、content/asset-set/manifest 三 hash 匹配编译登记的批准基线，记录不可变审核事实，再封存完整内部版本。固定快照包括来源、审核、内容/视觉/报告/资源/组件版本、确定性引擎、renderer、静态字体、验证与归档证据；历史读取重新验证规范文本及 SHA，不回退到最新配置。

新操作仅基于当前修订，原成功请求优先返回原回执。不同 key 的并发请求由事务与唯一约束收敛；审核及版本各有严格独立协议、请求指纹和最多 100 个不可删除槽位。未知响应保留原请求，只有精确成功或永久未应用证据才允许显式解除；跨组件失权立即撤销整页操作权威，普通详情 404/503 仍保留核实入口。

版本封存实际读取受限来源、归档图片、字体与许可证，并执行固定引擎的评分见证。实际 IO/数据库操作的所有者持续负责直到关闭；关闭拒绝、超时或未知提交不被 HTTP 返回、TTL 或清理成功状态掩盖。维护清理在首次 unlink 前持独占保护并验证完整 Product 图和跨图引用。0017 新增两表及约束，旧首稿和追加协议保持兼容。

详见[冻结合同](INTERNAL_VERSION_P3E.md)、[实现身份](INTERNAL_IMPLEMENTATIONS.md)、[独立审查](P3E_REVIEW.md)。

## 实际验证

| 检查                   | 当前结果                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| 格式、lint、TypeScript | eb7595a 完整 format/lint/`pnpm typecheck` 通过；f924f23 测试改动另经格式/lint/tsc 通过        |
| 单元                   | 145 文件、1710 项全部通过                                                                     |
| 最终 fresh PostgreSQL  | 56 文件、469 项全部通过，243.87 秒                                                            |
| 驱动兼容               | 先前同一驱动实现 ESM/CJS 46 项通过                                                            |
| 真实并发               | 两个不同 key 同时记录/封存：唯一行、唯一目标、两个正确审计，失败请求取得永久 target-used 事实 |
| 生产构建               | 80 traces、17204 路径、0 私有文件违规                                                         |
| macOS main 媒体        | 66 项连续三轮通过并封存；每轮操作实际停止、control 为空                                       |
| 最终生产浏览器         | 第四轮 241 通过/10 既有 skip，六项新增全过，约 6.0 分钟                                       |
| 四宽截图               | 20 状态×四宽，共 80 完整 PNG；两开发聊天各逐张看完，Astra 20 代表图                           |

准确 e0a5e62 的普通 CI [39123248278](https://github.com/aning0922/quiz-forge/actions/runs/39123248278)和 Linux 媒体 CI [39123248228](https://github.com/aning0922/quiz-forge/actions/runs/39123248228)均为实际 success。

两 hook 预算修复后的准确 5db7d46，普通 CI [39125409038](https://github.com/aning0922/quiz-forge/actions/runs/39125409038)及 Linux 媒体 CI [39125408991](https://github.com/aning0922/quiz-forge/actions/runs/39125408991)亦实际 success。这些 CI 不包含本机生产浏览器全套，不能替代其失败事实。

最终 main sourceBundle 为 `0f5a9c6dfa12e05a5f8e33dde0c492524ded8ad2c12123af77d285abef545916`，deployment 为 `97e76ee9bfa5067a37116bff015f57c75e58cf6a1a23b028701d9496b0f26003`，runtimeBundle 为 `812293f0e93afe2a027bb43dc6678494e67b1c61238a1d7889c7cf1f235bf6d3`；1059 source、918 artifact、35365569 字节。24 个 Next 生成 cache 文件共 98120399 字节移至本地私有保留目录后绑定；1877 个非 cache 条目（含根目录）的字节、mode 和 inode 不变，没有放宽大小限制。

准确 eb7595a 的普通 CI [39126766657](https://github.com/aning0922/quiz-forge/actions/runs/39126766657)及媒体 CI [39126766660](https://github.com/aning0922/quiz-forge/actions/runs/39126766660)均实际 success。前三轮本地失败仍分别保留；准确 f924f23 的普通 CI [39128057215](https://github.com/aning0922/quiz-forge/actions/runs/39128057215)与媒体 CI [39128057251](https://github.com/aning0922/quiz-forge/actions/runs/39128057251)均经主控及独审回读为 completed/success。

## 真实旧库与首款现场

原 0016 的 b71… 测试实例在 0017 前已存在首稿及 r2/r3。实际升级保留 14 表原数据、16 条迁移 checksum、5 个 blob 和原成功 key 回执；新旧 guard 分别拒绝不兼容版本，新增两表为空。独立复核与安全事实见[升级证据](qa/p3e-legacy-upgrade.json)。实例已停止保留。

用户批准的历史人物首款在独立 39eb… purpose=test 实例完成真实生产浏览器操作：10,887,344 字节原包接收、native 验证与九项资源归档、首稿 r1、author-baseline 批准落账，以及 slot 1 固定版本封存。三 hash 与批准产物一致，完整快照经 HTTP 复读和 SHA 校验。实际版本为 `ade95bd0-833f-4696-9f3c-33b0db223bdc`，安全事实见[首款现场证据](qa/p3e-first-product-live.json)。该轮运行代码为 4c29c09，之后两项后台文案修订不重写历史快照。原请求均经实际核实后显式解除；Next 获真实退出证明，数据库禁导入并停止保留，供后续 P4 接入。

该版本仍是 `studio-internal-preview`、`internal-test` 且 `publicationApproved=false`。用户已批准同一内容和视觉作为内测基线；这不替代消费者 Key、持久答案、唯一完成报告及 P5 真实闭环。

## 保留的失败和修复

最终生产 E2E 首轮 235 通过、1 失败、10 项既有 skip、5 项未运行。新增套件的 `beforeAll` 在业务测试开始前被 Playwright 默认 30 秒钩子预算中断；CLI 自身 90 秒预算中包含正常等待真实认证窗口的最多 61 秒。失败时新 fixture 已准备、未完成，写者及 Next 已退出，3100 无监听。434… 数据库正式停止保留，浏览器报告和截图移至 `.cache/p3e-e2e-first-failure`。正在修订钩子预算后用 fresh 实例重跑；不降低认证限制，不跳过新增测试。

4cd8c2f/5db7d46 将 beforeAll、afterAll 分别设为 120 秒，CLI 仍为 90 秒，业务 15 秒和六项完成门不变，预算修复经独审通过。fresh 第二轮 237 通过、1 失败、10 旧 skip、3 未运行，8.7 分钟；新增前两项审核和封存实际通过，取得 40 张四宽图。只读第三项点击核实按钮时，按钮在页面 render 异常后消失。主控用实际失败 fixture 的有效 DraftSummary 离线复现：将完整 DTO 传入只接受 productId/draftId/revision 的 strict URL helper，产生 unrecognized_keys；显式三字段投影正常。B 正做最小修复及组件浏览器反例，Astra 独立复验。afterAll 正确拒绝 finish；d4faa… 已正式停库，全部进程退出，产物位于 `.cache/p3e-e2e-second-failure`。这 40 图不作为修复后的最终视觉证据。

初次核心 PG 为 450 通过、1 失败，原因是旧测试精确表清单缺新增两表；修正清单后 41 定向通过。最终完整 PG 首轮为 186 通过、263 失败、18 skipped：第一个生命周期测试没有明确关闭前序套件留下的导入开关，fixture 按设计保留，后续 reset 持续拒绝导致级联失败。调用方现使用正式配置服务明确禁导入，未放宽生产清理保护；失败实例 f677… 已停止保留。独立测试再次从 enabled=true 起步通过，修正后新的 fcd… 完整 469 项全部通过，并已停止。

真实首款浏览器辅助脚本曾误等已成功创建后的导航、误把上传 201 当作 200，以及在封存前选取下拉框失败。均先读取权威现状再继续，没有重复创建、上传或审核。原失败记录保存在本地私有目录，未把辅助脚本失败记为生产业务成功或删除现场。

第三轮生产 E2E 为 239 通过、1 失败、10 旧 skip、1 未运行，5.9 分钟。版本列表、只读核实和 r2 历史均已通过；第五项的测试 route handler 把 replacement 新 key 的第二次响应仍按旧 tuple 校验，严格 client 正确拒绝并报 mismatch。92d7a90（root f924f23）改为仅首个旧响应的 one-shot 拦截，并等待实际交付及客户端收尾；Astra 实际 React/Chromium 双变体确认旧 handler 第二次失败，新 handler 只拦一次且第二个新请求经自己绑定校验成功，另一 seal 锚点不变。生产 client 与六项完成门未改。8322… 已正式停库，64 图及报告保存在 `.cache/p3e-e2e-third-failure`；第四轮采用新 f746… 实例。

## 最终退出与视觉结论

第四轮在 fresh f746… 由自有生产 Next 独占 3100，241/10 旧 skip、六新增全过；真实 worker/server 退出证明成立，P3E→P3D→P3C→B3→B2 精确清理通过，native control 为空，CLI 正式停库成功。最终 80 PNG 与原 test-results、manifest 的尺寸/字节/SHA 全部一致。A、B 分别逐张检查 80 图；Astra 实看 20 状态代表图、每宽 5 图，另核全部 80 图完整性。主控实际查看四宽各一代表图。详见[视觉记录](P3E_VISUAL_CHECK.md)。

无剩余 P1/P2；三类 P3 为部分控件间距、错误条留白和窄屏原生 select 尾部裁切，实际目标/操作资格仍清楚，后续后台 UI 批次收口。不把它们写为已修，也不将代理图检替代作者内容/素材/发布批准。

## 后续边界

[Draft PR #19](https://github.com/aning0922/quiz-forge/pull/19)堆叠于 #18，main 未合并。P3-E 出口后按已获托管授权继续 P4：独立内部执行版本、Key、匿名会话、服务器答案 CAS 和不可变确定性报告，再完成首款 P5 现场体验。技术验收自行推进；新内容、素材或发布批准仍交用户审核。
