# B2-2：可信复验与私有资源归档合同

日期：2026-10-12。状态：**B2-2A合同已由总控按独立Astra审查修订并冻结；B2-2B只冻结不变量，精确迁移/DTO尚未冻结**。
实施基线：媒体预检交付 `1f6f3880f1d5c920835f5cf235c2a93b28588c29`，准确代码736d923的普通与平台CI均success；父交付记录head的最终CI核清后才开始代码实施。
本文件记录工程决定，不宣称代码、迁移、业务接口或验收已经存在。

依据：[原验证归档提案](STUDIO_P2B2_VALIDATION_PROPOSAL.md)、[持久化尺寸证据](QUIZPACK_PERSISTENCE_PREFLIGHT.md)、[B2-1 合同](STUDIO_P2B2.md)、[媒体隔离预检](QUIZPACK_MEDIA_ISOLATION_PREFLIGHT.md)。
原提案保留推导和历史取舍；本合同明确决定优先于原提案建议值。未明确的 B2-2B 迁移及 DTO 不据此自动实施。

## 1. 范围与两个代码里程碑

目标仅为：对已接收的同一原包执行实际 P1 复验，冻结技术证据，归档全部资源字节并建立 Product 私有资源引用。
接收状态 `received` 永远只表示原字节已冻结；验证失败不改原 archive、接收 hash、时间或 upload attempts。
仅本机 loopback、显式受管开关、实际解析为 synthetic 的包；authored、未知版本明确拒绝，synthetic 字段不替代 OS 隔离。
没有草稿、评分/见证执行、结构或像素预览、人工审批、公开资源 URL、发布、消费者流程、任务队列或全局 GC。

| 里程碑 | 交付与退出边界                                                                                                                                                               |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B2-2A  | 可信 P1 桥接、生产隔离模块迁移、严格候选/证据及隔离 Next fixture 的实际编译产物兼容证明；无 DB、HTTP 业务接口、UI 或迁移。两流按下述接口并行，集成检查和独立审查通过后退出。 |
| B2-2B  | A 产物可用后，另冻结精确三表迁移、权限、服务/HTTP DTO，再实施统一存储、资源归档、恢复和后台纵向闭环。不得凭本文件预造数据库接口。                                            |

B2-3 才应用首稿；P2-C 才有私有像素读取、结构预览及送审；P3 才运行评分、见证和受控组件。
技术通过仍不授予资源商用授权、作者内容批准或人工视觉批准。

## 2. 执行预算与停止权威

- 业务期限为 Handler 入口起 60,000ms；A 的无 HTTP 调用由可信调用方提供同一绝对 monotonic deadline。
- 图片串行，单张执行截止为 `min(业务截止, 单张开始+5,000ms)`；8MiB/16MP/8192 固定生产限额不变。
- 取消、业务超时、storage 锁失效立即阻止新增解码、文件提升和业务完成事务。
- 从停止触发起最多 5,000ms 收尾，当前 launcher 停止/stdio、在途文件 IO 和句柄关闭共用这一期限；不能先等 launcher 5 秒再额外延长 5 秒。
- 收尾只允许等待、关闭及证明齐全后写一次 stopped receipt；不得新开业务 DB 连接、释放预留或写 ready。
- 未在收尾期限内核实全部停止，返回恢复所需的固定错误并保留对象/计量；定时器不代表 OS 调用硬实时终止。
- lease 120,000ms，不无限续期；每 validation key 最多 3 个执行 attempt。已确认提交的结果不因随后超时而改成失败。
- 稳定 limits/hash 与请求剩余时间分离；外层期限只收紧执行，不改变政策 hash。

A-R提供统一上下文工厂 `createMediaOperationContext`。它绑定外部signal、业务绝对期限及单次停止状态；首次取消/超时/明确停止请求固定共用cleanup deadline，后续请求只能收紧，不能重启5秒。A-V及B原样传递同一个上下文，不能每图/每层重建。上下文的有效身份与只收紧的状态由受信任实现检查，不凭可改的结构字段声称已执行；精确类型由A-R第一公共接口交付，先于平台核心实现交接。

单图执行超时、取消、运行失败或STOP_UNCONFIRMED使整个候选结果interrupted并立即停止后续inspector调用。已确认停止的内容/格式拒绝可以成为rejected；P1 issue不能吞掉未知停止或将可恢复运行失败固化为内容结论。B可在整个candidate调用前一次持久化media-stop-unconfirmed，只有聚合结果证明全部媒体与相关IO停止后才解除，无需每图新增DB回调。

B2-1 的主进程 ESRCH 不能直接充当 B2-2 媒体停止证明。调用 launcher 前，必须先持久化当前 attempt 的 `media-stop-unconfirmed` 事实。
只有实际返回 `stopped: confirmed | not-started` 且本次相关输入/输出、文件任务均 settled，才能解除相应未确认事实。
崩溃留下该事实时，普通 recover 保守返回需维护；不能因主进程退出、lease 过期或控制目录后来变空释放占用。
本批不建立自动跨重启杀进程平台。若将来需要自动恢复，另审 attempt 与持久化 invocation 的绑定、实际进程/容器停止查询和权限。
A 必须提供足够的 run/profile/stop 事实；B 负责把它们与 attempt 绑定，不让 P1 media failed 隐藏 STOP_UNCONFIRMED。

## 3. B2-2A 两流文件所有权与交接

| 实现流        | 独占文件/职责                                                                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-R：运行模块 | 新 `src/features/quizpack/server/media/**`；原 `scripts/quizpack-media-preflight/{shared,macos,linux}/**` 的运行核心、公共类型、测试迁移与离线适配；发布固定媒体入口、统一上下文与runtime binding类型。              |
| A-V：可信验证 | `src/features/quizpack/v1/**` 的必要内部执行拆分及独立 canonical 预算；新 `src/features/quizpack/server/validation/**` 的快照、dispatcher、候选、Unicode/报告 Schema；对应测试。调用 A-R 公共入口，不改其 internal。 |
| 总控          | package/锁文件、Next/build/CI 接线、部署身份清单、共享文档和集成顺序；目标 worktree 封存及生产启动串行验收。两流提交建议，不并发改共享文件。                                                                         |

以下为 A 的目标接口，**当前尚未实现**；路径/类型归属在开工前由对应所有者先交桩，接口调整先回总控。

```ts
// server/media/index.ts：A-R；P1 declaration/facts 复用既有类型。
createMediaOperationContext(input: {
  signal: AbortSignal; deadlineMonotonicMs: number;
}): MediaOperationContext;
runIsolatedImage(bytes: Uint8Array, declaration: ImageDeclaration,
  context: MediaOperationContext): Promise<LaunchResult>;
// MediaOperationContext必须来自该工厂，共用单次停止/收尾期限。
// LaunchResult 保留预检已审的 decoded/failed、runId、profileId 和 stopped 联合。

// server/validation/index.ts：A-V；只有可信服务可调用。
validateArchiveCandidate(archive: Uint8Array, targetProductId: string,
  context: MediaOperationContext): Promise<CandidateResult>;
// CandidateResult：accepted/rejected/interrupted 严格联合，含有界证据。
// accepted 持有同快照 manifest/content、资源集合及 hash，不能序列化进 DTO。
// interrupted 明确 stopped/需维护事实；无候选可归档，不冒充内容永久拒绝。
```

CandidateResult 的完整 strict 字段由 A-V 在第一实现检查点交给 A-R/总控审阅，先于 B2-2B 冻结；不得以 `unknown`/任意 JSON 占位充当完成交接。
同一调用同步复制输入并冻结声明/政策；内部 Buffer 不对浏览器或可变调用方暴露。HTTP/包内容不能选择 inspector、路径或政策。
媒体绑定读取/核对由 A-R 内部提供有界可信接口：预先计算证据身份，运行时仍核同一绑定；不存在任意命令或探针参数。

## 4. 单一执行核心与离线能力分离

建议模块：`media/index.ts`、`image-runner.ts`、`runtime-binding.ts`，以及 `internal/macos`、`internal/linux` 的 execute/control/policy。
普通入口固定经 normal-policy 检查 sealed capability，再进入同一 image-runner 和平台 execute；无第四参数、skip、candidate 或 scenario 选项。
内部执行计划仅由受审可信模块构造。TS brand/internal 名称不是沙箱；拒绝任意请求参数和固定依赖方向才是实际代码边界。
`server-only` 保护业务入口；离线工具使用项目既有 react-server 条件，不增加生产绕过 shim。

- Mac：把 worker/fault/posix/mac 闭集映射及探针路径移到 scripts adapter；生产只保留固定 P1 worker。
- Mac 权限模板和 runOwned 生命周期只保留一份；离线探针用同模板构造自己的固定计划/profileId。
- Mac 原 native helper 拆出生产身份查询；共用 query_bsd 实现，Mach 服务、spawn-self 等测试入口留离线 probe。
- Linux：fixedScenario、FAULTS、runProbe/合成选择移出生产 controller；普通 entrypoint/worker 参数固定。
- Linux 命令监督、身份 inspect、stop/wait/stdio 屏障和容器限制只有一份实现；不得复制成第二套“生产简化版”。
- 原受审镜像若暂保留 probe 文件，普通入口仍不可选择；完整镜像 digest 继续绑定。另拆镜像须重新验收，不继承旧能力。
- candidate 检查、封存、编译、故障 worker、探针和 harness 均留 scripts；离线工具调用新核心，生产代码不反向导入 scripts。

有限依赖 guard 只检查关键边界：Studio/validation 仅引用 media 公共入口；业务不得引用 media internal、scripts 或离线候选入口。
内部生产模块与离线 adapter 可以按所有权引用核心，不把检查扩成通用仓库治理框架。
必须证明普通入口忽略/拒绝额外候选参数，未封存/不匹配不启动；candidate 测试不写正式能力。

## 5. 生产构建定位与实际执行身份

首批只支持完整受管 checkout 的 `next start`，不承诺 standalone/serverless 部署。tsx harness 通过不是生产入口验收。
不能沿用被 Next 打包后失真的 `import.meta.url` 向上猜根，也不能仅 hash 原 `.ts` 文件便称已绑定运行中的 `.next` 代码。
首个 A-R 集成检查点必须交出可运行的 locator/build binding 方案及产物证据，满足以下性质：

1. 构建时核实 checkout 实路径；运行时固定定位并核根身份，不从 HTTP/env 选根、不搜索整个父目录。
2. 有限角色映射到固定相对路径；普通 worker 保留受审 `.mjs`，helper 由离线 setup 编译到受管工具目录，请求不安装/编译。
3. 构建生成严格、有界的 runtime binding，记录代码/worker/helper/依赖事实；不包含凭据、控制状态或用户数据。
4. 实际 Next 服务端执行产物也有部署身份：可用构建后有限清单绑定实际代码闭包；源码 hash 仅作为来源证据，不能替代它。
5. 具体 chunk 发现、上限、加载方法及是否需构建调整先用真实产物验证；目前不假称任何未测试的 Next chunk 路径或 hash 已正确。
6. 若选择独立编译的运行模块，须证明 Next 实际调用同一产物且打包没有另复制未绑定实现；不能仅产出未被调用的“证明文件”。
7. 能力文件位于构建外固定受管位置，由离线封存器写、普通入口只读；不能静态 import 成过期 bundle 常量。
8. 每个被验构建分别执行 build → 核实际执行产物绑定 → target-worktree record → sealed 普通入口矩阵；seal 不再改变已绑定代码，避免 build/seal 自循环。A 的 fixture 与 B 的应用构建分别取得身份和能力，不共享封存。

component identity 覆盖新入口、image-runner、平台 execute/control/command、locator、权限模板/normal-policy、协议/strict 输入输出、生产 helper、P1 worker、native 依赖与 limits。
离线 adapter/probe 另进入矩阵证据身份。完整文件字节保留，不能删去 workspace 相关 semver 包装字节来伪造稳定身份。
目标 worktree 的路径/依赖/代码变化需重新核对和封存；普通请求绝不自动“探测后授权”，未知平台或身份不符失败关闭。
trace guard 继续拒绝私有运行配置、control、uploads；明确区分可交付代码/非敏感绑定与本机私有状态。
A 没有业务调用方，模块可能被 tree-shake；允许临时、隔离的测试专属 Next fixture 或离线构建 driver 显式引入新入口，以真实 next build/next start 验证实际编译产物正常运行和失败关闭。fixture 可有仅测试所需的调用入口，但不得写入永久业务路由或发布应用。
fixture 必须调用同一生产源码并绑定真正执行的 artifact；仅启动 Next、运行源码 tsx 或执行未被 Next 使用的旁路副本均不足。其结果只证明编译/运行兼容性，不宣称当前应用已存在该业务路径。
B 接入真实业务路由后，必须对最终应用构建重新确认 locator、执行代码闭包、依赖/权限、部署 identity 及普通 sealed 路径；重新 record/封存并通过真实路由验收。A 的 fixture identity、能力文件和通过结论不能作为 B 的部署授权。

## 6. 同字节 P1 桥接及严格持久化证据

P1 当前 validate 直接调用裸 inspectImage。A-V 必须抽出同一 validator 的可信内部执行入口，后台固定注入隔离 inspector；不能先裸验证再补沙箱检查。
旧离线 P1 公共入口保留兼容语义；后台只有隔离分支。有限 launcher 错误映射为有限 P1 issue，停止事实另存且不能丢失。
原包限额、受限 ZIP/parser 和引用/兼容检查复用，不引入第二套解码器；允许同快照两次有界解压但不重置总期限。
先严格识别 schema/Product/synthetic，再完整 P1；只有六项 checks passed、candidateValid 和所有绑定一致才产生 accepted 候选。
首批只识别 `quizpack.v1 + quizpack-content.v1`；未知 v2 明确拒绝。manifest/product 与 route Product 精确相同，packId 保留独立 P1 语义。
后台 Unicode policy 在写前拒 NUL/未配对 surrogate，不替换/截断；DB/连接必须 UTF-8。此 policy 版本/hash 进入验证键。

| 量                             | 固定上限/口径                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| raw content / manifest         | 1MiB / 256KiB，保持 P1 原限额                                                                                |
| canonical content / manifest   | 2MiB / 512KiB；独立 P1 canonical 预算，F1 helper 保持 1MiB                                                   |
| 单资源 declaration             | 64KiB，前提是上述 Unicode policy                                                                             |
| 单份最终 P1 report             | 256KiB，strict Schema 与实际 canonical UTF-8 字节双检                                                        |
| 最多三报告净 payload           | 合计 768KiB；不是整个数组/envelope 大小                                                                      |
| envelope 外围 metadata/control | 64KiB，不包含 report payload；每 attempt 最多 64 项媒体事实、三 attempt 合计最多 192 项，固定字段/有界字符串 |
| 完整 evidence envelope         | 1MiB，包含所有报告、字段名及包装字符                                                                         |

最终报告固定六项 checks、最多100 issues、有限代码注册表、受限 path/message 和固定 unverified；unknown code/超限属于桥接失败，不截报告。
parser 原始 issues 不能直接冒充最终 validator report。P1 importable/publishable 保持 false，许可/审批字段始终只是 claim。
报告按 attempt 追加、每份冻结且绑定 hash/身份；成功候选及其报告只冻结一次，恢复不改报告或把新 decoder 结果挂到旧报告。
权威 JSON 使用 canonical text 保存；SQL 按 `octet_length` 检查并验证可解析 JSON，常用查询走明确列，不误用 jsonb::text 的不同字节口径。
具体 strict Schema、有限码注册表、envelope 与 hash 规范由 A-V 交付；纯尺寸证据不代替完整 P1 或 B 的真实 DB 验收。

## 7. B2-2B 待细化但不可违反的不变量

只新增 quizpack_validation、asset_blob、product_asset 三表；精确列名、触发器、迁移版本及权限在 A 退出后另审冻结。
validation 保留独立 revision/fence/attempt；状态 `validating → validated → archiving → ready`，确定内容/policy 拒绝为 rejected。
停止已证实的运行失败可 retryable-failed；提交未知保留实际阶段与 unknown 存储条件，不伪造回滚成功。
validation_key 服务端绑定 received archive bytes/hash、Product、完整 validator/runtime bundle、P1/兼容/limits/后台 policy hash；请求 deadline 不入键。
同 key 幂等重放不加 attempt；响应丢失先查询 import 的既有记录。政策变化是新证据，不自动重写旧记录。

| 短事务   | 原子完成事项                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------- |
| claim    | 当前鉴权、Product active、received 绑定、key、attempt/fence/预留；提交未知不启动读取/解码/候选 IO。      |
| evidence | 完整报告、候选/hash、资源计划、规范包身份冻结；提交未知不继续 blob 提升。                                |
| complete | 事务外物理核验之后，当前身份/fence/lease、全部 blob/资源引用、ready 和审计一次提交；部分引用不能先成功。 |

请求独占 DB 从 createDatabase 起受总预算约束；复用 withStudioWrite 的 auth 锁及当前身份重验，失效 client 永不重连。
固定锁序：身份预检 → storage try-lock → 配置/扫描 → 短事务 auth → Product → import → validation；资源按 hash/主键稳定排序。
事务 callback 不读文件/解码/hash，无 auth 锁跨 IO、无持 auth 等 storage；迟到 callback 不得继续外部副作用。
recover 只核实未知结果、推进 fence、对账，不加 attempt；重新验证/继续归档使用显式 retry，最多3次。无后台自动重试。
旧 validated 候选只能按同 bundle/计划重建并核字节继续归档；旧 bundle 不再可用时新建验证，不能改旧技术证据。
主机/媒体停止未知保留计量；不会凭租约、锁空闲或 DB 断开删除原包/blob。实际完成提交已确认时保留成功。

规范包身份按 Product/packId/packVersion 唯一；同身份异 archive hash 冲突，同 hash 可直接别名 canonical 行，禁止别名链/环。
product_asset 按 Product/resourceId/resourceVersion 不可变；只有 blob 与完整 declaration hash 都相同才复用，source_validation_id 保留首次来源。
每次 validation 有自己的完整 asset-set；跨 Product 复合 FK 强制归属，知道 SHA 不授予资源元数据读取权限。
blob 和资源引用无应用 UPDATE/DELETE/DDL；技术报告/候选事实 write-once；具体受限权限和约束需真实 PG 证明。

统一 scanner/quota 同时升级 receive 与 validation：512MiB 逻辑字节，旧原包、blob、残留/孤儿/unknown 和所有 held headroom 一起计量。
每执行新预留128MiB+64KiB；不抵扣原包，同一 attempt 临时/最终双名不得少计，别的 namespace 不抵扣本次 headroom。
沿提案固定1024 imports/1024 validations、每对象16文件、4096 blobs、全扫描8192项/5秒、receipt2048字节/每对象最多3份；预留未落地名称，最后 IO 也检查期限。
每 Product 最多20未完成 validation；行查询 limit+1。超限保守维护，无全局 GC；recover 对账不因超额而被新增写入准入规则永久锁死。
路径仅服务端生成，0700/0600、无链接/inode核对、no-clobber；首批不删除正式 blob，不提供公开 URL 或资源像素接口。
512MiB 不是 RAM、镜像、WAL 或全实例磁盘硬限额；ENOSPC 独立失败。受管开关继续覆盖接收/验证/归档，默认关闭。

## 8. 退出证据与后续冻结

A 必验：两引擎合成包同字节完整验证；版本/Product/authored拒绝；实际坏 ZIP/JSON/媒体；严格报告/Unicode/canonical 边界；取消与未知停止事实不丢失。
A 平台必验：新核心上的正常三格式、native失败、拒读写/网络/额外进程/IPC、超时/close/崩溃屏障；隔离 Next fixture 实际 build/next start、artifact 绑定及专属封存匹配，依赖 guard/trace guard。
A 两流先各自定向检查，再总控集成检查及独立审查；新核心和 Next 编译产物兼容性必须有实证，旧66项或纯 mock 不能代替。A 退出不代表 B 的实际业务部署已验收。
B 冻结前交付：精确 SQL/触发器/权限、browser-safe DTO/错误码、服务签名、HTTP CAS/replay/recover/retry、目录 UI 状态及真实验收矩阵。
B 必验包括真实 PG 三提交点、事务回滚/未知提交、当前降权/归档、同/异资源冲突，以及真实文件/连接故障、统一配额、late IO/停止证明和生产浏览器；另须完成最终应用构建与真实业务路由的实际部署 identity 重绑、重新封存及成功/失败关闭验收，不复用 A 的 fixture 身份。
UI 分开显示 received 与验证/归档状态；ready 只称“私有资源已归档”，审批 unverified，没有草稿成功、评分通过或发布按钮。
独立Astra已确认分批范围与fixture/真实业务路径分离，并提出共用收尾上下文、原shared目录归属两项开工前补齐，现已纳入第2/3节。A-R第一公共接口须具备上述停止字段/分类再交A-V。各里程碑真实检查未完成前，不记录为功能实现或验收通过。
