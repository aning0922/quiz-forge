# R1 运行环境与备份恢复

2026-10-21。状态：本地技术验收完成，实际实现、非空恢复和独立审查见 [R1_ACCEPTANCE.md](R1_ACCEPTANCE.md)；最终交付提交的准确 CI 记录在 Draft PR #22。

## 范围与基线

作者明确要求开始“运行环境与备份恢复”，沿原独立开发、独立审查聊天方式托管推进，并保留现有内测环境。代码基线为已归档 main `c6fba4bae3e5fa7e6d765f0d06c9f875d0d78fdc`，标签 `p5-internal-beta-1`。

本批交付可执行的受管本地备份/恢复工具、产物校验、隔离恢复演练和运行维护说明。目标是把同机原目录启停扩展为可验证的数据与私有资源恢复。支持环境、源实例条件、快照一致性与恢复身份必须在实现前冻结；未验证的平台不宣称兼容。

不包含正式商品发布管理、批量 Key 运营、新主题、AI、支付、生产迁移或对外部署。既有归档标签保持不变；本批提交推送与 Draft PR 后交付验收，不自动合并 main。

## 原内测环境保护

- 原 managed-resume 工作树及准确构建不切换、不重建；原数据库、私有素材、Key 与报告保留。
- 不读取或公开作者答案/结果，不复制真实用户记录作开发测试。恢复覆盖已有实例和目录必须拒绝。
- 开发、故障测试与演练使用独立合成数据和自有实例；失败现场保留，不将未知结束视为可删除。
- 阶段开始的只读检查确认原数据库 running，原网页进程未监听 3100。全量 E2E 仍须独占 3100，不复用未知服务；主控在验收后复核原体验入口。

## 交付与验收条件

1. 备份合同明确数据库、私有资源、配置、实现版本和证据的包含/排除范围；一致性来源可解释、可测试。
2. 工具验证源/目标身份、路径、权限、文件类型、大小、数量与完整性；凭证、原始数据和资源不进入公开日志/Git。
3. 未完成或损坏的备份不能通过验证；存在未知数据库/文件/子进程结果时不得报告成功。
4. 在新的受管目录和独立端口恢复，验证迁移历史、权限与业务引用，实际读取旧报告/素材，完成新测评；记录源与恢复后的完整性比较结果。
5. 真实 PostgreSQL、失败边界与 CLI 测试通过；主控完成格式、lint、类型、单测、生产构建、完整 E2E 及适用媒体检查。
6. Astra 独立复核合同、实现与实际恢复证据，关闭阻断项；记录真实提交、测试、限制和下一阶段条件。

## 分工

- 主控：范围与共享合同、package scripts、集成、完整验收及阶段交付。
- A 独立开发聊天：数据库快照/恢复、身份与权限检查、真实隔离 PostgreSQL 回归。
- B 独立开发聊天：私有备份产物、文件与完整性验证、CLI 流程和恢复演练工具/说明。
- Astra 独立审查聊天：共享合同前置审查、实现独审、反例复验与交付证据审计。

具体模块接口和文件所有权见下文。共享合同冻结后按范围并行实施，接口变动先由主控协调并复审。

## 已冻结的维护备份合同

### 支持范围

首版面向本项目受管的本地 PostgreSQL 18.4 实例，源为 `test` 或 `demo`，固定当前迁移及运行实现。应用与文件工作先静止，数据库保持运行以生成逻辑备份；不承诺业务无中断热备。只恢复工具自身产生、来源受信且完整性验证通过的产物，不作为通用 SQL 或第三方备份导入器。

源环境先核身份、代码与迁移历史、配置、目录和实际进程条件。备份过程中保持维护约束，使数据库、原包、验证资料与 blob 的取证和复制有共同的一致性依据。不能仅凭设置 `imports.enabled=false`、端口暂时空闲或租约到期断言工作已经停止；未决/未知文件操作是拒绝条件。

Astra 初审确认维护模式可行。必须在取得原迁移锁、storage 排他锁并阻止受保护表写入后建立快照；不能先在 RR 事务中查询 schema/时间而固定旧视图，再用后取的锁冒称新鲜。`pg_dump --snapshot` 必须显式绑定持续存活的 exporter，文件引用与表指纹也读该快照。锁的存活检查、失效信号与最终真实关闭都参与成功判定；失锁即永久失去本次封存资格。

源 origin 独占保留只用于防止该地址的新应用启动，不能替代原应用/worker 退出证据、同库其他 backend 检查和全部持久文件任务状态检查。任何未知后台、未决文件任务或不完整 guard 均拒绝；不得借本工具清理原任务或改写历史完成状态。

### 数据与文件

- 使用 PostgreSQL 原生逻辑备份，并把同一数据库快照下的迁移记录、表内容指纹及资源引用纳入私有清单。表内容本身不进入公开结果。
- 私有文件按有界、显式清单复制，覆盖恢复业务图所需原包、验证资料与资源。不能只保存 blob 却宣称完整导入/审核历史可恢复，也不递归复制整个 `.cache`。
- 不打包 PGDATA、临时 socket、浏览器状态、任意调试日志或未知文件。原始运营登录凭证和已发放私密链接的保管另行说明，不从数据库摘要逆推出明文凭证。
- 备份产物使用私有目录与文件权限，逐文件检查大小、类型和 SHA-256，拒绝路径穿越、符号链接、硬链接、重复路径、未知项和预算超限。校验和只证明完整性，不声称提供加密或来源认证。
- 完成标记必须晚于全部已发起的数据库/文件/子进程操作真实结束与最终校验。未完成、损坏或结束状态未知的产物保留为失败现场，不能被恢复入口当作成功备份。

### 隔离恢复

- 在新的受管工作树根目录恢复，目标实例目录必须不存在，数据库和应用使用明确的独立 loopback 端口；拒绝覆盖旧实例或复用未知监听者。
- 拟保留源逻辑实例 ID、数据库/角色名称和不可变业务记录，重新生成目标数据库登录密码，并重新绑定物理根目录、端口和受管配置；不得全量替换业务 JSON、旧版本摘要或迁移 checksum。
- 不直接复制源 `runtime.json`/`admin.json` 明文密码或旧物理路径；恢复配置由受验证的有限元数据重新构建。
- 恢复后默认关闭导入，核验迁移历史、schema/权限、完整表指纹与私有资源引用，再停止本工具新建的数据库，交付“已验证、已停止”状态。恢复失败仅停止本工具确实拥有的新进程并保留现场，不删除源或重试覆盖目标。
- 合成演练包含已完成报告、进行中答题与尚未使用的 Key；恢复后通过实际业务接口核旧报告、恢复进度并完成新测评，且源实例保持不变。时间限制沿真实时钟，不回拨时间或延长旧凭证有效期来伪造兼容。
- 新端口不隔离同 host 的浏览器 Cookie，数据库密码轮换也不会撤销已有运营/消费者 token。恢复副本不是可同时接待同一用户的第二写权威。R1 HTTP 演练只用合成凭证与新浏览器 context，源 HTTP 先真实退出，目标显式绑定新配置，完成后再次停止。真实环境接管需另定单一权威和凭证处置方案，不由恢复成功自动授予发布或接管权限。

Astra 已对准确 `083ad8183de90920d59345223f559ccea9e83689` 独立运行 20 项合同边界，全部通过，确认无合同级阻断；主控据此冻结并启动 A/B 实现。下述约束是实现验收条件，合同通过不代表真实备份、恢复或运行演练已完成。

### 机器接口与所有权

机器结构见 `src/features/runtime-recovery/contracts.ts`，类型接口见 `ports.ts`，公开错误码见 `errors.ts`。这三份文件由主控单写，已包含于上述冻结提交。固定 23 张业务/迁移表与 18 项迁移历史；清单分别限制数据库 dump 512 MiB、私有文件总量 512 MiB、8192 项目录/文件、manifest 4 MiB、单次操作 300 秒。超限拒绝，不静默裁剪。这里的有限预算是首版本身的支持范围，不是已完成性能测试的结论。

私有文件只允许 `uploads/blobs/<sha>.blob`、`uploads/imports/<uuid>/archive.quizpack` 与 import/validation 的 `stopped-<uuid>.json`，并保留列明的空目录。临时 `.partial`/`.tmp`、孤立记录、缺失 DB 引用、未决任务及不匹配回执不能通过源准入；SHA 清单并不替代来源闭合检查。数据库表指纹必须使用一致的排序和文本编码/时区约定，目标以相同算法比较。

| 所有者 | 文件范围                                                                                                                                                    | 接口责任                                                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 主控   | `contracts.ts`、`ports.ts`、`errors.ts`、package scripts、阶段文档                                                                                          | 有限机器合同、集成与总体验收                                                                                          |
| A      | `database*.ts`、`snapshot*.ts`、`restore*.ts`、`source*.ts`；`src/lib/db/management.ts` 必要的兼容扩展；独立数据库测试                                      | `withQuiescentRecoverySnapshot` 管理快照/锁/PG 子进程/源文件闭合；`restoreManagedRecoveryData` 建新受管实例并验证停库 |
| B      | `artifact*.ts`、`files*.ts`、`service.ts`、`cli*.ts`、`code-identity.ts`、`scripts/runtime-recovery*.ts`、`tests/recovery/**`、`docs/RUNTIME_OPERATIONS.md` | 私有产物复制/校验/封存、运行时验证能力对象、CLI 与合成演练                                                            |
| Astra  | 独立审查工作树与审查证据                                                                                                                                    | 合同、实现和真实演练反例复核，不并发修改实施文件                                                                      |

快照回调只在 lease 有效期间复制与验证有限清单，`dumpTo` 使用已拥有的新私有文件描述符；A 只有在 exporter、全部锁和已发起 IO/子进程真实收尾后返回。B 在此之后完成所有私有文件核验与关闭再封存。恢复只接受 B 验证器实际签发且仍有效的 capability，不能通过 JSON 或类型断言伪造；A 通过 capability 取得 dump 描述符和有限资源安装能力。目标根固定为执行命令的受管仓库根，不接受任意覆盖路径。

首版 CLI 提供 `runtime:recovery doctor|backup|verify|restore`。`doctor` 只检查环境/代码，不读取用户数据；`backup` 只接显式源实例 ID；`verify` 与 `restore` 接收私有产物路径和独立保存的 manifest SHA-256，`restore` 另接明确的目标数据库端口与 loopback origin。未通过完整验证不得创建目标数据库；不得从备份载入源运行配置或执行调用者任意 SQL。完整脚本和安全输出以最终实现与验收为准。

### 精确比较与能力认证

数据库指纹格式固定为 `pg18-jsonb-pk-lf.v1`：23 张表按 `RECOVERY_TABLES` 顺序；会话固定 `TimeZone=UTC`、`DateStyle=ISO`、`IntervalStyle=postgres`，逐行读取 PostgreSQL `to_jsonb(row)::text`，按经 schema 核验的主键列顺序排序（文本键使用 C 排序）。每行直接以 PostgreSQL 返回字符串的 UTF-8 字节追加一个 LF，流式累计 bytes/SHA-256/rows；不经 JavaScript Date 或 JSON 重编码。空表 bytes/rows 为 0、hash 为 SHA-256 空串。`graphSha256` 为规范 JSON `{rowFormat,migrations,tables}` 的 SHA-256。源和目标使用同一算法，原 JSON/text 字段的实际内容差异会改变指纹。

`codeSha256` 为代码文件清单摘要，不是 Git commit SHA。B 的 `code-identity.ts` 单独实现口径：固定根文件 `package.json`、`pnpm-lock.yaml`、`tsconfig.json`、`next.config.ts`、`postcss.config.mjs`、`.npmrc`，以及 `src/`、`scripts/`、`migrations/p2a/`、`patches/`、`public/` 下全部实际文件；逐项检查无符号链接/非常规文件、限定数量与大小，按相对 POSIX 路径排序，生成 `{schemaVersion:"quizforge.recovery-code.v1",files:[{path,bytes,sha256}]}` 的规范 JSON 并取 SHA-256。不含文档、测试报告、Git 元数据、依赖目录、构建产物或任何私有运行目录。源取证前后及目标恢复前必须比较；变动不能沿用原验证资格。运行环境仍须冻结安装和匹配原工具链，代码指纹不冒称依赖目录或未知原生程序可信。

B 的 `artifact.ts` 必须导出模块级 `assertVerifiedRecoveryBundle(bundle): void`，基于内部 WeakMap 等不可从 JSON 伪造的状态认证来源、未关闭状态及预算。A 在任何目标创建之前调用此函数，不能仅调用入参自己提供的 `assertValid` 方法。能力暴露的 manifest 必须深度不可变，真实 IO 使用内部保留的清单与身份；关闭或验证失败永久撤销该能力。`pg_restore` 在新空库内由非 superuser 的同名 owner 执行完整 schema/data/post-data，保留 ACL；不使用 `--no-acl`、数据-only 禁触发器或 `session_replication_role` 绕过。支持受信本地自产归档，不能将 TOC 检查和 SHA 校验宣传为任意 SQL 沙箱。

dump 固定为 PostgreSQL 18.4 `pg_dump -Fc` 的 custom archive（`format:"pg18.4-custom"`），字节数至少 1 且不能仅凭 manifest 声明接受：实际持有 FD 必须验证长度、SHA、custom 格式头，随后由 A 以匹配版本 `pg_restore` 核有限 TOC/对象集再开始目标创建。A 新子进程 owner 必须限时/限输出，等待 `close` 与全部管道结束，不把旧 `runPg` 的 `exit` 事件直接当作完整 IO 结束证明。

## PostgreSQL 18.4 目标恢复规范化决策

真实隔离探针确认 RR READ ONLY 允许 SHARE 锁，生产 exporter 使用只读事务，仍须先锁全部表再首次读取/导出快照。实际 `pg_dump -Fc --snapshot` 和非 superuser 的空库完整 `pg_restore` 均已正常 close/exit 0，但直接恢复后的 draft/consumer 精确 schema guard 拒绝，因此命令成功尚不等于恢复成功。

A 对完整 catalog 的取证与 Astra 独立比较确认：300 个列、54 条枚举记录、40 个函数、84 个索引、22 张 qf 表和 173 个触发器完全一致；只有下列六个 CHECK 的数组整体转换与逐元素转换表达形式改变。六项均保持 valid/enforced 为 true、deferrable/deferred 为 false，常量集合和顺序不变。

| 约束                                          | 受信原表达式来源                                                    |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `asset_blob_media_type_check`                 | `0010_validation_assets.sql` 的 asset_blob.media_type               |
| `product_asset_purpose_check`                 | `0010_validation_assets.sql` 的 product_asset.purpose               |
| `quizpack_validation_last_error_code_check`   | `0010_validation_assets.sql` 的 quizpack_validation.last_error_code |
| `draft_revision_engine_id_check`              | `0014_product_first_draft.sql` 的 draft_revision.engine_id          |
| `draft_revision_content_schema_version_check` | `0015_supported_pack_admission.sql` 对同名约束的原始定义            |
| `draft_revision_content_kind_check`           | `0015_supported_pack_admission.sql` 对同名约束的原始定义            |

原完整 catalog SHA-256 为 `906ca3748d7991b3a2095cb4a603465c5abb776e2df0213f2ee84ff7b2f98ab6`，准确 PG 18.4 dump/restore 变体为 `a6453c24d23b26941fd461e8f04392575424cf7f7ea5463499f0696cf7186d99`。schema-only 证据文件 SHA-256 为 `add9f0dc60df697fd66632e5e4a44c2dd5e09ad44fed13eaa3d4aa6f86a71728`。这些是 schema 取证，不包含业务行或凭据；已核六项 CHECK 的属性与列依赖，依赖证据 SHA-256 为 `9f8c5ca7b1c9374eaba76579fd5bec25d7118bc6c0d07df7eb0ee3438cd22e94`，未声称逐项审查全库 pg_depend。

Astra 已接受以下受限方案，实现与真实成功/拒绝/回滚试验现已分别通过开发及独立复验，详见验收记录：仅在本工具新建、尚未开放 HTTP 的目标上，在同一事务中先核完整 catalog 精确匹配上述已知变体，再以仓库固定原表达式 DROP RESTRICT/普通 ADD CHECK 重建六项，并验证完整原 hash 和原有全部 guard。普通 ADD CHECK 必须检查已恢复行，禁止 NOT VALID、CASCADE、IF EXISTS、禁触发器或宽松比较。若已完全等于原 hash，则无需规范化；任何其他 catalog、ACL 或约束变化均在首条修复 DDL 前拒绝。事务失败回滚，目标停止保留失败状态。

这一步还原新目标的原定义，不修改源库、旧迁移 SQL/checksum、迁移账本、业务文本或原 schema guard。完整表指纹/资源闭合校验仍须通过，不能仅用 schema hash 代替数据验证。
