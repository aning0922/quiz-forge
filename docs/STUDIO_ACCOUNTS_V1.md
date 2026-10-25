# Studio 后台账号首版合同

基线：`6c30b8cc532feb8bd95c6987bebfe6d254d2b7c6`。作者已授权本批设计、实现、必要验证和独立演示；真实环境迁移、main 合并、生产部署另行授权。2026-10-25 独立设计审查通过；在途登录撤销、所有密码计算预算、已消费 token 原结果核实三项已定向收口。设计放行不是实现验收。作者随后明确本项目处于 demo 阶段：直接以新方案组织账号密码和人员管理，不承担旧 demo 凭证、路由/API、中间版本和备份的长期兼容；必要时重构受影响部分。事务、并发、幂等、服务端权限、密码与会话及新系统数据一致性继续保留。现用环境、作者数据和未提交成果保持原位。

## 1. 身份与角色

账号使用稳定 `qf.operator.id` 关联本系统操作与业务记录；唯一 `login_name` 用于登录，可改的 `display_name` 用于展示，PHC `password_hash` 用于认证，递增 `account_revision` 用于 CAS 与在途认证失效。原 label/credential 列作为既有底座字段保留，不为它们提供网页登录或迁移入口，也不因修改显示名称改写业务归属。新演示直接初始化最终结构与合成数据。

- 登录名：ASCII 3–64 字符，去首尾空格后转小写，`[a-z0-9][a-z0-9._-]{2,63}`；数据库保证规范值及唯一，停用不释放。首版不提供登录名改名。
- 显示名：1–80 个 Unicode code point，复用目录文本的 well-formed/控制字符边界，允许中文；修改显示名不改变原 label 或 ID。
- 展示状态：disabled 优先；无密码或未配置登录名为 pending（待设置密码）；其余为 active。待设置账号没有账号密码登录能力。
- 有效管理员：role=admin、operator.status=active、登录名已配置且密码 PHC 符合本版策略。尚未设置密码的管理员不计入保护数量。
- `StudioSessionDto` 保留原 id/label/role/期限字段，role 增加 admin；扩展可选 loginName/displayName/accountRevision，实际新服务完整返回。账号管理使用独立的完整 Account DTO，不能根据缺失字段推定权限。

浏览器和服务端使用同一个纯角色能力表；服务端仍只接受数据库核实过的 branded actor。不能以“不是 read-only”代替具体能力。

| 操作                                                    | admin | operator | read-only |
| ------------------------------------------------------- | ----- | -------- | --------- |
| 现有允许的测评/版本/状态读取和只读预览                  | 是    | 是       | 是        |
| 创建、编辑测评，分配现有分类标签，导入、检查、草稿修订  | 是    | 是       | 否        |
| 测评归档/恢复、维护全局分类标签                         | 是    | 否       | 否        |
| 审核确认/退回、记录审核依据、封存、创建答题版本         | 是    | 否       | 否        |
| 对已有可用答题版本发码、作废未领取码                    | 是    | 是       | 否        |
| 人员/角色管理、重置入口、账号操作记录                   | 是    | 否       | 否        |
| 修改本人密码、退出当前/全部登录、查询本人原账号操作回执 | 是    | 是       | 是        |

保留现有消费者正文、原始 Key 和私密结果权限：新增 admin 不是消费者数据通行证。发码和作废从笼统 workspace 写能力分为明确能力；创建答题版本保持管理员能力。

## 2. 密码与计算边界

固定专用密码实现 `argon2@0.44.0`（MIT），Argon2id v=19、m=65536 KiB、t=3、p=1、随机盐 16 bytes、输出 32 bytes，参数显式指定。PHC 只在服务端/数据库使用，验证前限制算法、版本、参数和编码长度，拒绝借存储值请求无限成本计算。

密码按 well-formed Unicode、NFC 规范化后计数，15–256 个 code point，UTF-8 最多 1024 bytes；不 trim、不截断、不强制字符组合或定期更换。允许空格、粘贴、显隐和密码管理器。拒绝本地有限的常见/预期弱口令，不向外部服务发送密码或摘要，不宣称完整泄漏密码库覆盖。

本机 Node20.20.1/arm64 私有样本：0.44.0 原生加载、正确/错误验证通过，64MiB 参数单样本 hash 约 115ms、verify 约 103ms，不作为生产容量承诺。0.45.1 虽声明支持 Node20，但本机原生导入发生 SIGSEGV，失败保留，未采用。不得为该依赖修改全局 Node/pnpm。

KDF 在数据库锁外运行；每进程最多 2 个执行、8 个排队，排队有界。请求超时或取消不能提前释放仍在计算的容量。正式采用后补该平台与 CI Node24 的必要加载证明，不新增无关密码算法。

## 3. 会话、预约与撤销

沿用当前会话 Cookie、Host/Origin/Fetch Metadata、CSRF、preauth、30 分钟空闲/8 小时绝对期限及认证锁 `(72461,1)`。新 demo 只提供账号密码登录；旧随机凭证网页入口删除。

密码登录分为两段短事务：

1. 锁内核实 preauth、CSRF、已有失败限额，预约唯一验证 attempt（ID、30 秒期限），取得当前 account_revision/PHC。预认证行可增加预约字段；不能重复领取同一未到期预约。KDF 前有全局最多 20 个 KDF 计算单位/60 秒的预约预算，并保留现有 preauth/失败预算，审计增长有界。
2. 锁外执行 KDF。未知、停用、未设密账号使用同成本 dummy 验证，统一失败文案，不泄露账号存在性。
3. 再取认证锁，重新检查 attempt、时间、账号状态、revision/PHC 未变，才消费挑战并插入正常 session。停用、改密、角色调整或退出全部发生在计算期间，旧验证结果必须失败。

账号停用、角色调整、成功设置/重置/修改密码，以及本人或管理员发起的全部会话撤销，都在同一认证锁内递增目标 account_revision 并撤销目标全部旧会话，使早于撤销的在途密码验证不能落成新会话。撤销先提交则旧预约登录拒绝；登录先提交则新建 session 也被后续撤销。退出当前只处理当前 session。恢复停用账号不恢复旧 session 或旧 token。

账号模块使用有限的专用事务收尾处理自撤销：仍验证动作前当前身份/权限/目标版本，提交前验证动作规定的最终状态，不要求被本次操作主动撤销的 session 继续有效。操作其他账号时仍复核发起者。现有 `withStudioWrite` 的业务保护不放宽，沿用驱动的已回滚/COMMIT 不明分类；Cookie 只在明确提交后写/清。

## 4. 一次性设置、重置与改密

新增 `operator_password_token`，绑定目标 ID、用途（setup/reset/bootstrap-admin/admin-recovery）、签发者、摘要、签发/到期/消费/撤销时间和受控计算预约。32-byte 随机 token，独立用途前缀/摘要域；30 分钟有效，一次性消费。仅保存摘要，不保存原文。

重新签发在一个事务中撤销前一 token 并创建新 token。在途旧 token 即使已开始 KDF，最终事务也必须拒绝。停用、角色变更、成功改密/设密使相关旧 token 失效。签发 reset 本身不提前清空当前密码；UI 明确“本人完成重置后旧登录才全部失效”，立即阻断访问使用停用或撤销会话。

成功消费 token 的同一事务：核对当前 token/预约/目标状态与版本 → 存储新 PHC → bootstrap-admin 此时才升为 admin→ 递增 revision → 消费/撤销 token → 撤销目标全部旧 session → 写审计及原操作回执。不自动登录，随后使用账号密码登录。不能因超时、过期或 UNKNOWN 猜测设密已完成。

新设置入口 `/studio/set-password#token=...&tokenId=...`；tokenId 仅为不可信的非敏感恢复索引，不参与授权。客户端可在 inspect 拒绝已消费 token 时，用该精确索引恢复原 operationId 并调用只读 result；首次 inspect 成功时核对该索引一致。token 只经 fragment 进入客户端，读取后从地址栏移除并只留在当前内存，不能写 localStorage/sessionStorage、日志或截图。该页及接口 no-store、no-referrer，不嵌入第三方资源。

设置/重置接口以一次性 token 为限定 bearer 权限，忽略当前正常 session 作为授权来源；仍执行严格来源、JSON 大小/期限检查，CSRF 值从该专用 token 按独立域派生。不得将该能力转成普通后台身份。它不要求退出当前浏览器的其他账号，也不清除无关账号 Cookie；成功后给出重新登录/使用独立窗口的明确指引。

本人修改密码必须验证当前密码；PHC 计算在锁外，最终锁内复核账号/session/预约和 revision。成功撤销全部登录并要求重新登录。密码值、快速密码摘要、PHC 都不能进入浏览器 pending storage、操作回执或审计。

所有 KDF 入口（密码登录、setup/reset/bootstrap/recovery、本人改密）通过独立 `operator_kdf_attempt` 表共享数据库 20 个计算单位/滚动 60 秒预算；改密占两个单位，其他占一个，先取得有界本地容量、再在认证锁内计入预约后才计算；既有登录失败 10 次/60 秒限额保留。本人当前密码验证另按目标账号最多 5 次预约/60 秒计费，包含在途和失败，不能以多 session 绕过。token 同时只能有一个未到期计算预约。所有预约均为 30 秒，绑定 attemptId、用途、目标 revision，以及该入口的 preauth/session/token 身份；写入类还绑定 operationId。锁外计算结束后只允许原预约在当前时间和版本下完成；过期、重签、撤销、角色/状态变化后不得复用计算结果。预算及拒绝记录有界，不能只依赖进程内 semaphore。

## 5. 管理操作、UNKNOWN 与审计

新增 `operator_account_operation`：保存稳定 operationId、操作者、动作、目标、非敏感绑定、最终结果/错误及时间。管理创建/修改显示名/角色/状态/签发 token/撤销全部均要求 UUID operationId，修改已有目标带 expectedRevision。相同键不同非敏感绑定拒绝；相同已提交操作只返回原回执，不执行第二次。

创建/签发 token 的原始链接只在首次确认响应中返回。响应丢失后先查原 operationId；只确认原操作，不把账号当前值冒充原回执。无法重新取回原链接时，明确说明并由用户另行确认重新签发，不能自动旋转 token。setup UNKNOWN 可凭同一 token+operationId 查询有限原结果；本人改密/退出全部可在重新认证后查本人原操作。

token 的写校验与结果读取分开：写入口始终拒绝已消费、撤销或到期 token；`password-setup/result` 仅做只读匹配，要求 token 摘要、其实际绑定的 operationId/目标/用途一致，并限定在签发后 24 小时内。该有限原回执读取可在 token 已消费、重签撤销或写权限过期后进行，不延长写权限、不返回密码/PHC/新 token，也不能再次执行写入。查询无对应最终回执、绑定不符或超过读取期限时，客户端保持 UNKNOWN，不推断失败或自动重签。页面只持久化无秘密的 tokenId/operationId 核实索引，不持久化 token 原文或摘要。

密码不用于持久的快速请求指纹。密码类原 operationId 只确认原已执行动作，不以第二次提交的密码内容宣称已修改；UNKNOWN 后不开放盲重提。

账号操作记录只返回业务动作、操作者/目标安全显示、数据库时间、结果和安全编号；不返回 PHC、credential/token/session 摘要或原文。开通、角色、显示名、停用/恢复、token 签发/完成、会话撤销记录在同一动作事务中；认证失败及拒绝保持有界。历史 operator_id 不改写，旧维护记录缺失的操作者不伪造。

最后管理员检查在同一个认证锁内进行：停用或降权有效 admin 前必须确认存在另一名有效 admin；两名 admin 并发互相停用/降权最多一笔成功。新 pending admin 不算替代者。网页服务和本机停用工具都不能绕过。

## 6. 最小数据库权限与独立初始化

0019 仅增加 admin/必要审计枚举，提交后 0020 增加账号列、token/operation/KDF 预约三表、约束和有限函数。已有迁移文件保持，独立实例按当前完整结构初始化；部分结构状态 fail closed，不自动切换作者环境。本批不建设旧账号/凭证迁移桥接。

app 不获得 operator/token/operation/KDF 预约表直接 INSERT/UPDATE/DELETE，也不使用 maintenance 连接。采用固定动作、字段白名单的有限 SECURITY DEFINER 函数：固定 owner、`search_path=pg_catalog`、完整限定对象名、撤销 PUBLIC EXECUTE、仅显式授权所需函数。函数以 session/preauth/token 摘要验证数据库中的当前主体，不接受调用方自报角色或 actor ID 作为授权。密码读取经有限验证预约函数，不将 PHC 加入安全 DTO。

新增函数、列、类型和 ACL 纳入精确 catalog/schema 校验；不笼统允许任意 definer 或放宽旧断言。旧数据服务/消费者合同校验保留。

本批不扩展旧 demo 的 R1 备份格式、跨版本恢复或迁移兼容，也不把历史恢复证据当作新账号 schema 的恢复验收。原环境和原工具仍在原工作树保留。当前账号 demo 使用独立实例；本批没有宣称旧 R1 工具可备份/恢复该新结构。

## 7. 最小接口与页面接线

继续使用 `/api/studio/auth/preauth|session|logout`；`/auth/password-login` 接收 `{loginName,password}`。新 demo 的网页登录统一使用账号密码，移除旧 `/auth/login` 及 `/studio/login/legacy` 入口。

| 接口                                                | 权限与输入/结果                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| POST `/api/studio/auth/password-login`              | preauth+CSRF；账号密码，统一失败；正常 session DTO/Cookie                                                 |
| POST `/api/studio/auth/password-setup/inspect`      | 专用 token+派生 CSRF；只返回限定目标显示、用途、期限、密码策略                                            |
| POST `/api/studio/auth/password-setup`              | token+派生 CSRF、operationId、password；一次性提交，不自动登录                                            |
| POST `/api/studio/auth/password-setup/result`       | 同一 token+operationId；有限原结果核实，不签发新 token                                                    |
| GET `/api/studio/accounts/me`                       | 当前身份；完整安全 Account DTO                                                                            |
| POST `/api/studio/accounts/me/password`             | 当前 session+CSRF、operationId、当前/新密码；成功撤销全部                                                 |
| POST `/api/studio/accounts/me/logout-all`           | 当前 session+CSRF、operationId；成功清当前 Cookie                                                         |
| GET `/api/studio/accounts`                          | admin；分页/状态/名称查询，安全字段                                                                       |
| POST `/api/studio/accounts`                         | admin+CSRF、operationId、loginName/displayName/role；pending 账号及一次性设置入口                         |
| PATCH `/api/studio/accounts/[id]`                   | admin+CSRF、operationId、expectedRevision；严格动作之一 display-name/role/disable/restore，不接受任意字段 |
| POST `/api/studio/accounts/[id]/password-token`     | admin+CSRF、operationId、expectedRevision；setup 或 reset，重签先撤旧                                     |
| POST `/api/studio/accounts/[id]/revoke-sessions`    | admin+CSRF、operationId、expectedRevision；目标全部会话撤销                                               |
| GET `/api/studio/accounts/operations/[operationId]` | admin 或原操作者本人；只读原结果，降权后仍可核对本人已发起操作                                            |
| GET `/api/studio/accounts/audit`                    | admin；分页账号操作记录，无秘密                                                                           |

Account DTO 至少含 id、原 label、loginName|null、displayName、role、status(pending/active/disabled)、revision、createdAt、disabledAt。错误码保持稳定 code/requestId：ACCOUNT_CONFLICT、LOGIN_NAME_TAKEN、LAST_ACTIVE_ADMIN、PASSWORD_POLICY_REJECTED、PASSWORD_CONFIRMATION_FAILED、PASSWORD_TOKEN_INVALID、OPERATION_BINDING_CONFLICT；401/403继续现有失权链，未确定提交仍为 WRITE_OUTCOME_UNKNOWN。

“我的账号”沿 `/studio/session` 重组，系统设置加入 `/studio/accounts` 和 `/studio/accounts/audit`。短操作用现有保留式任务弹窗，危险影响有确认，密码字段允许显隐/粘贴/密码管理器。页面不展示维护数据库、PHC 或技术实现参数。

## 8. 跨账号与重新认证的原任务保护

所有新 pending bucket 加 operatorId 所有权；发码继续既有 issuer 分区，草稿/修订/审核/封存补同等隔离。无归属旧 bucket 不自动认领、不删除、不迁给新账号，提示按原身份核对来源；不依据当前值直接结算旧未知请求。

运行中 owner 在创建任务时固定 operatorId。失权后保留可保留的 DOM/File、原 tuple、mayHaveBeenSent 和原编号并禁写；重新登录只读核对当前身份与能力。不同账号不得读取/重放旧 owner 的 pending，保留原状态并明确要求返回原身份。相同账号须用户明确读取当前状态/核对原操作后再选择恢复动作；不自动重发或复活已撤销 authority。

相同账号确认恢复时可创建新的 authority generation 并更新当前 session/CSRF，但旧 generation 永久失效；旧异步回调不能因重新登录恢复效力。不得用重挂载原任务来丢弃 File 或未提交输入。

## 9. 维护工具、实施切片和验证

本机工具只在明确 instance 和 operatorId 下操作，私有 setup 文件 O_EXCL/O_NOFOLLOW、0600，保留 COMMIT 不明现场及原 operationId。bootstrap 只在尚无管理员配置时按明确的新 UUID 创建首个管理员待设置身份，无自动取第一行或旧身份迁移。本人成功设密时才取得 admin 权限。recover-admin 只处理指定的现有 active admin，不作为任意升权/恢复停用的后门。工具不代作者设置密码。

首片：密码登录、bootstrap/本人设置、我的账号改密/退出全部、本机 admin 恢复。次片：管理列表、创建、角色/状态、签发入口、审计、跨账号任务恢复。全部在独立合成实例，提供真实可操作演示和对应 Draft PR；作者真实环境不自动迁移，main 不自动合并。

必要验证：真实隔离 PG 的完整初始化、最小 grant、跨角色服务端拒绝、停用/角色/撤销与登录及业务写竞争、两个 admin 并发保护、pending admin 排除、token 到期/重签/并发单次消费、改密撤销及 UNKNOWN 原回执；相关密码/HTTP/DTO和浏览器角色/显隐/恢复路径。不追加历史兼容和旧备份恢复验证；评分/媒体/报告/消费者完整流程不重复全套。一次管理员独立完成全部工作、以及 admin→开通人员→本人设密→按角色操作→改密/reset→角色/停用失效→审计为交付体验链。

依据：[NIST SP800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)、[OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)、[node-argon2 0.44.0](https://github.com/ranisalt/node-argon2/tree/v0.44.0)。采用后的依赖版本、实际平台证据和具体接口冻结点追加于本文，不扩大本批范围。

### 当前 demo 的依赖修补与实现登记

独立集成构建发现 Next 16.4.0 的已公布安全缺陷，固定升级 Next / eslint-config-next 16.4.3、Zod 4.6.6；不升级 React、数据库驱动或系统工具。依据最终安装和锁文件登记预览渲染 1.0.1、消费者渲染 1.0.2；两个评分引擎的算法声明仍为 1.0.0，以新的精确 entry SHA 表示依赖修补，评分代码和内容合同未改。

原有五份实现描述文件保持原字节，仅当前新身份可执行。旧身份仍可查询事实，执行明确拒绝，不自动改绑固定版本或报告。新 demo 使用全新隔离库；作者既有服务、构建、数据库继续由原工作树运行。本批不建设旧依赖执行兼容层。

对应验证：登记检查通过；依赖修补影响的实现解析、评分/内容 schema、密码及请求边界 102 个用例通过（首轮 100 通过、两个 gateway 用例因测试辅助参数误插失败；修正后仅重跑该文件四例通过）；最终真实隔离库的 fixture 保护五例通过；生产构建与 trace 检查通过。构建失败记录原样保留，不计为成功。浏览器和演示结果另在下方最终交付中记录。

## 交付、演示与验证边界（2026-10-25）

交付 PR：[Draft #29](https://github.com/aning0922/quiz-forge/pull/29)，基于已合并 V2-A `6c30b8c`，保留独立开发与 Astra 独审。主要集成提交：账号服务 `9dc01b9`、后台 UI `e895214`、当前密码登录精简 `519e927`/`6f11f66`、时限与 owner 原操作核实 `a907ba6`、任务恢复 `ede64fc`/`86630b0`、依赖与当前实现登记 `5951684`、时间投影修复 `9f273ff`。最新精确 head 与 CI 结果以 PR 为准；后续文档或测试改动不冒充运行行为改变。

演示入口为 `http://127.0.0.1:3220/studio/login`，独立 demo 实例 `c11227fe267a46be424172a7d32b985e`（PG 55444）。四个账号为 `demo.admin`、`demo.operator`、`demo.reader`、`demo.backup-admin`；密码仅在此工作树 `.cache/accounts-v1/demo-credentials.txt`（0600）供本机作者打开。建议使用独立无痕窗口，避免与其他 127.0.0.1 演示共用 Cookie。该实例通过真实页面/API 建立账号和一个空测评，不包含作者答案、私有素材或虚拟业务进度。

本批真实浏览器使用生产构建、Chromium 156.0.8078.4、专用 test 实例 `e475d8722d679bcff475d7e46dc246bb`/3120。先检查账号首次设置与管理员会话保留，发现 SQL 的微秒时间经过严格消费者格式器返回 null；追加 0021 仅在 DTO 输出截毫秒，原 0018/0020 checksum、存储期限、权限和事务保持。新完整 schema/catalog 指纹为 `8df3b6889d4db4481ed9de114b7d1d7f7c98bbf8b44bddbf9c098070ebfafa93`。迁移只在自有实例执行，不操作作者环境。

- `.cache/accounts-v1/live-1792934427804/result.json`：56 条检查完成，包括真实创建、设置/改密/重置、停用与恢复后旧会话失效、运营创建测评、只读写入与账号管理 403、四个窄屏宽度、真实提交后响应丢失且按原 token/operationId 找到结果、无重复写。末尾探针在 modal 仍打开时点击外侧恢复入口超时，因此该批总体标为失败，不能计作整轮通过。
- `.cache/accounts-v1/live-1792934535918/result.json`：只补该降权恢复路径，先确认原已完成操作，再有意设置角色执行一次明确的新测试动作；按正常操作收起弹窗后核对原账号，原 receipt 可查询/结束、无管理员写入口，真实审计与旧登录 HTTP 路由移除也通过，15 条检查。未重跑前一批业务链。
- `.cache/accounts-v1/demo-1792934610557/result.json`：实际 demo 合成数据初始化与展示 36 条检查完成，桌面 1440×1000、移动 390×844 代表截图。此为真实服务/DB 演示核验，不是作者体验或实机批准。审计来源文案的最终定向检查 `.cache/accounts-v1/demo-1792935181988/result.json` 六条通过，新截图确认“设置链接持有人”和“本机维护工具”的正确来源。
- 复用独立 A 的界面/请求边界定向证据、B 的真实数据库权限/并发/截止/密码预约/回执证据。主控另运行依赖修补相关 102 例、fixture 保护 5 例；自动 CI 发现的维护 receipt 断言仅补 2 例（39 个范围外跳过不计通过），导航/登记/超限数组安全拒绝仅补 13 例。0021 的真实 HTTP handler 投影回归及原微秒期限不变复用 B 的通过结果。
- 最终运行构建 `kysFoxp_GxmbWCSSrApql` 对应产品源码 `a030e3e`；其后的测试/文档修订不改变运行输入。生产构建、类型和 trace 检查通过。Linux 媒体 CI `40196372413`（5951684）及 `40197106430`（9f273ff）实际成功；未另行重复本地全量媒体矩阵。普通 CI 的初轮失败（未用 import、旧测试契约、旧业务 fixture 账号假设）保留；最终 CI 状态在 PR 交付说明核实，不将排队、失败或未运行项记为通过。业务 fixture 中的管理员动作按当前角色准备，版本/消费者 fixture 改用真实密码登录；仅在明确成功后精确清理本次新 preauth 绑定的唯一已完成 KDF 预约，账户预算测试保持独立且不使用此清理。B 的三个领域 fixture 定向六例通过、23 个范围外跳过；主控切换当前密码登录后的版本/消费者生命周期两文件三例通过，日志为 `.cache/accounts-v1/version-fixture-password-final.log`。早先旧管理员登录导致的失败实例停止保留，未删除现场换取通过。后续 taxonomy/Unicode/产品归档七个原失败用例已限定使用管理员，40 个范围外跳过；P4 完整旧图读取改用持锁内的 owner 连接，仍在第一次删除前比较，原拒绝未知行用例通过。

限制：只适用于本机隔离 demo；设置/重置链接手工私下交付，无邮件、短信、公开注册、SSO、多租户或支付。无完整泄漏密码库，未做生产容量承诺或移动实机验收。新账号数据库不宣称兼容旧 R1 恢复工具；旧作者环境继续保留在原工作树。当前新登记拒绝旧实现执行，不批量改写历史固定版本或报告。等待作者体验后再决定下一步，本 PR 不自动合并、对外部署或创建 Release。

最终连接保护补验：`0473772` 的 checks 与 Linux media 已实际成功，baseline DB 中的旧角色/受保护列读取差异另由 `158c743` 及后续测试提交修正。消费者 expiry 曾在 CI 的清理连接检查拒绝未知连接，日志不能证明连接来源。调查中尝试的 `backend_type='client backend'` 过滤被真实外部 app 连接反例否定（owner 视角字段为 NULL），该尝试未提交，已完全撤回；原“所有外来 PID 均拒绝”规则保持。新鲜隔离 test 实例上，原规则的 expiry 与外部连接/关闭未知隔离两例均通过，`.cache/accounts-v1/ci-original-connection-guard.log`，75.50 秒；没有忽略 NULL、减少断言或清除失败现场。最终自动 CI 以 PR 上最新 head 的实际结果为准。

最后一个故障注入子进程 `tests/support/p3e-close-fault-child.ts` 同步改用上述当前密码登录 helper；未改故障注入、原键核实、关闭未知或停止证明。对应 FD/DB 关闭拒绝两例通过（45.56 秒），日志 `.cache/accounts-v1/ci-close-fault-password-fixture.log`。`3d05060` 的常规检查与媒体检查成功，原连接保护的 expiry/quarantine 亦在该次 CI 通过；其数据库整批因这一旧登录调用失败产生的后续清理拒绝仍记为失败，不能用定向结果冒充整批成功。
