# B2-2A 技术验收

日期：2026-10-12。状态：**技术验收通过；不等于内容、商业或发布批准**。
实施基线：媒体预检最终1f6f388；最终运行代码bdd5c51，集成记录head `4793537c98229803f274644133e6f10b769b1e68`。
[Draft PR #12](https://github.com/aning0922/quiz-forge/pull/12)保持OPEN/Draft，base为codex/media-isolation-preflight，未合并main。过程及失败历史见[P2B2A_REVIEW](P2B2A_REVIEW.md)。

## 实际交付

- 同一输入快照执行完整P1检查，后台固定使用生产隔离媒体入口。严格accepted/rejected/interrupted证据保留原包、资源、报告和运行身份；候选与资源字节由私有句柄持有，不能由浏览器JSON签发。
- 统一不透明operation context，60秒业务预算、每图最多5秒及首次停止后共用5秒收尾。UNKNOWN只能保守升级，保留原owned身份；单图运行失败停止后续媒体，未证停止不会转成内容永久拒绝或已清理。
- Mac/Linux执行、身份和生命周期核心迁入生产模块；离线脚本只提供固定故障/探针角色。普通入口无candidate/scenario参数，部署根只来自实际server编译宏，缺封存或身份不符关闭。
- 有界源码/真实Next产物/固定依赖/Sharp native映射清单，严格单个Next alias规则和仅离线构建权限归一化。普通verify不改权限，不扫描任意根。
- 固定target离线矩阵→进程内一次opaque receipt→记录与capability封存。只支持维护期间独占串行运行，不支持热封存；审计JSON不能恢复或伪造receipt。
- 隔离Next fixture实际编译并调用生产公共入口；无永久测试业务路由。两种P1包各4个资源通过，复制后的字节、Product归属、报告和绑定均一致；importable/publishable仍为false。

## 检查结果

| 检查                   | 实际结果与范围                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| 格式、lint、TypeScript | 本地通过；最终head普通CI也全部通过                                                                  |
| 单元                   | 最新本地68文件、873项通过                                                                           |
| 离线脚本控制           | 最新本地43项通过，无跳过                                                                            |
| 真实PostgreSQL         | 本地18文件214项通过；最终head远端database job通过                                                   |
| postgres驱动故障       | 本地ESM/CJS共46场景通过                                                                             |
| main生产构建           | 本地通过，53份trace、8614路径、0私有违规；最终head远端构建通过                                      |
| 生产Chromium E2E       | 本地206通过、10项既有跳过；后续增量只在离线harness/测试/文档，没有修改被测UI/业务路由               |
| macOS target           | 同一固定构建66项连续3轮全通过，全部owned停止/每轮control零残留，opaque record与capability均实际提交 |
| Linux target           | 31smoke与11lifecycle全通过，实际opaque record与capability提交                                       |
| 实际Next sealed入口    | 两平台均11个场景通过，服务childClosed/portClosed为true；另有未封存关闭检查                          |
| 独立审查               | 合同、生产入口、P1桥接、构建/依赖映射、离线封存、真实driver及最终Mac故障适配的已登记P1/P2全部关闭   |

4793537的[普通CI38194638007](https://github.com/aning0922/quiz-forge/actions/runs/38194638007) checks/database及[平台CI38194638047](https://github.com/aning0922/quiz-forge/actions/runs/38194638047)均已核实completed/success。不是排队或仅已创建workflow。最终文档提交的CI另核并补到PR描述。

本地DB/driver回归在68de75d检查点执行，E2E使用501e9e6的main构建产物；之后只有离线平台harness、纯测试与文档变化，生产业务模块/路由未变化。最终head远端重新执行格式、lint、类型、单元、离线工具、构建、真实数据库和Linux目标矩阵。A没有新增UI，不把旧截图或自动浏览器断言冒充新视觉验收。

## 目标构建证据

以下是本次实际fixture实例的有限身份，不可复制给新工作树或B的真实应用构建。两平台均Node20.20.1、Next16.4.0、React19.3.0；宿主实际Sharp0.35.5及native闭包纳入清单。source 1027文件/artifact 74文件，Mac读取27503632 bytes，Linux28125566 bytes。

### macOS

- sourceBundleHash：`1fbb89f572b1fed98e35aef16d813915d41a08286d2d8bfcd5a4e55e57533c00`
- deploymentId：`be695f88b2f020479915fbe05faeb40910cd8c5d886d90f07d04dbff0694fc71`
- componentId：`2db8a0e3c0842c91b36079cd8e23d763814c178f94aa523cc51dd312520422a3`
- runtimeBundleHash：`a66f67e45d2a41e3cd90acbd47b8c9d2e3a85934fde6210ed3c8974cc77b0126`
- profileId：`e5de190ec7bebca3d3a6fddb1d9e8e3846da5dd9ea2c83d48bbc6e4a9e055e31`

### Linux CI

- sourceBundleHash：`97a0211c32d034cf4fff9c74099e9b2aab463ea3a4ac6c7a99329f3c725a52d8`
- deploymentId：`d302210663125c85217c27c332c884b0dc998e6aeaad1457b07b48291f526e75`
- componentId：`fbc72d96685e1f1a899d0530fcd34434bd835f8e76423333517ae42ab5ffbc3b`
- runtimeBundleHash：`f3818444b99891edcbc0453734465568d0ff9544c8c45e9d409dafc2582b1789`
- profileId：`cb382cb13b2f3038e668c5e1a97511c4cd893fc363b4859bdec88414d9e343a8`

Mac矩阵代码hash为`709ecb6c167d91896b7c1e8bcf23307be4d087d721b655ef5616330e2a608ba5`。本机最后控制目录为空；3100/3111/55423无监听，自有数据库实例已停止。Linux服务和容器停止由实际矩阵及CI退出证明。

两个平台均实际通过image解码、dimensions/archetype候选，wrong-product/authored/unknown-schema拒绝，bad-zip/bad-json/bad-media的P1拒绝，以及cancelled/expired零媒体中断。合法候选的资源复制隔离、声明hash/byte长度、Product归属和六项报告检查不是HTTP200推断，由真实route与独立生成输入摘要核对。

## 限制与下一阶段

- 仅synthetic的quizpack.v1/content.v1；authored和未知版本明确拒绝。首款四卡内容仍在独立草案，未偷换为synthetic导入或商业批准。
- 无B2-2B三表、业务HTTP/UI、私有blob归档、草稿应用、评分、预览、发布或消费者Key。A的隔离fixture通过不代表这些业务已存在。
- Mac仍没有硬RSS隔离保证；采用受限输入、单worker和实际停止策略。Linux验证的是固定受管Docker能力，不推断任意宿主、serverless或standalone支持。
- 原Mac失败轮与0项启动失败轮保留为失败。一次性离线维护只隔离已核实退出的合成控制/哨兵目录并保留原字节，不补原5秒停止/stdio证明，不写业务receipt，不引入自动跨重启恢复。
- B必须对新实际业务构建重新build/bind、target矩阵/record/seal，并通过真实业务路由；不能继承本页任一capability。B精确三表、恢复/配额和DTO候选见[存储提案](STUDIO_P2B2B_STORAGE_PROPOSAL.md)，下一步先冻结其迁移与接口，再按文件所有权并行实施。

本检查点完成后按已授权托管路线接续B2-2B，不恢复旧D1暂停聊天，不进行main合并、生产迁移、部署或发布。
