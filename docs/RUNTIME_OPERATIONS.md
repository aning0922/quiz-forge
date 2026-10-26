# R1 受管本地环境维护

当前边界（账号清理专项）：本文件的 R1 备份/恢复操作属于固定 18 条迁移的历史归档版本。当前账号结构不支持该恢复合同，`runtime:recovery` 及旧随机凭证演练入口已从当前分支撤出；下方恢复命令仅用于对应已封存历史工作树，不能对当前账号实例照搬。未扩展跨版本迁移或新版账号备份能力。仍有当前用途的受管实例、文件/进程停止证明和媒体准备规则继续适用。

适用合同见 [RECOVERY_R1.md](RECOVERY_R1.md)，当前候选、独审和实际验收状态以 [PROGRESS.md](PROGRESS.md) 为准。本文件说明已接入 CLI 的操作顺序，命令存在、doctor 或文件测试通过均不代替完整真实恢复与 HTTP 验收。现有 39eb、作者资料、原工作树和归档标签保持原位，开发演练只使用新建合成 test 实例。

## 环境与凭据

备份/恢复支持 macOS arm64、固定 Homebrew PostgreSQL 18.4 及项目声明的 Node 版本。命令必须从正式 origin 的独立受管仓库根执行，先用冻结锁文件安装依赖。doctor 仅检查仓库、工具链和代码字节，不连接业务数据库、不读取用户资料、不启动服务或配置媒体运行时。包完整性校验不需要启动 PostgreSQL；Linux 工具测试不等于 Linux 恢复支持。

代码摘要包括合同中的六个根配置文件以及 `src/`、`scripts/`、`migrations/p2a/`、`patches/`、`public/`。上限为 16384 个文件/目录项、单文件 32 MiB、总文件字节 256 MiB、摘要清单 4 MiB；超限拒绝。依赖目录、构建、文档、`tests/` 目录和 `.cache` 不参与摘要；`src/` 内的 `.test.ts` 仍按全部实际文件计入。摘要不是 Git SHA，也不验证 node_modules 或未登记原生工具。恢复目标需使用同一实际代码字节和相匹配的冻结工具链。

产物本身包含敏感数据库记录、凭据摘要、会话与资源。0700/0600 和 SHA 校验不提供加密。备份和独立保管的 manifest SHA 只交给被授权的维护人员；不提交 Git，不通过公开日志、截图、工单或公开 URL 传递。原始运营登录凭证、已发放 Key/私密链接需另行私下保管，无法从数据库摘要恢复。工具不复制源数据库密码、runtime/admin 配置、PGDATA、socket、浏览器状态、原生运行时 capability/control、日志或整个 `.cache`。

## 命令与结果

主控集成入口为 `pnpm runtime:recovery`。参数采用 `--name=value`，要求规范绝对路径；不接受重复或未知参数。示例中的路径和 ID 仅为占位，使用前替换为自有实例及新目录。

```sh
pnpm runtime:recovery doctor
pnpm runtime:recovery backup --instance=<32位小写hex> --out=/绝对路径/全新私有备份目录
pnpm runtime:recovery verify --bundle=/绝对路径/备份目录 --manifest-sha=<独立保存的64位SHA>
pnpm runtime:recovery restore --bundle=/绝对路径/备份目录 --manifest-sha=<独立保存的64位SHA> --pg-port=55426 --origin=http://127.0.0.1:55427
```

doctor 的 `environment-verified` 只表示环境和代码可检查。backup 的 `sealed` 表示已等待本次源快照、数据库子进程、锁及文件 IO 收尾，产物已通过内部完整性检查。输出的 manifest SHA 必须独立保存，不能让备份内自报 SHA 成为唯一信任锚。verify 的 `integrity-verified` 表示产物格式和字节完整性通过；不表示业务恢复、来源认证或任意 SQL 安全。restore 只有在数据库、迁移、权限、完整表指纹和私有文件检查通过且新建数据库实际停止后，才返回 `verified-stopped`。

CLI 只输出有限状态、摘要和 allowlist 错误码，不输出连接密码、原始报告、任意路径、PG stderr 或堆栈。不要通过增加原始错误日志来绕过这一边界。

入口由 package script 固定 `TSX_TSCONFIG_PATH=./tsconfig.json`、`--conditions=react-server` 和 `tsx`，从当前仓库根执行 `scripts/runtime-recovery.ts`，直接组合真实数据库 ports。建议使用 `pnpm --silent runtime:recovery ...` 取得单条安全 JSON；不要继承其他项目的 TSX 配置。Ctrl+C/SIGTERM 转为取消信号，入口等待实际收尾，不通过强制退出伪造关闭。

## 冻结来源与新目标工作树

先在准确源仓库根核对 `pwd`、`git rev-parse --show-toplevel`、`git remote get-url origin`、`git status --short --branch`。origin 必须是正式仓库，代码与工具链均采用本批已审查的准确候选。把源的准确 commit、doctor 返回的 `codeSha256` 和支持环境信息记在私有维护记录中；备份开始后保持代码字节冻结。源取证前后及目标恢复前均会重新比较代码身份，不能以 commit 名相同替代实际文件摘要。

从源仓库根为准确候选创建一个全新的受管 worktree，使用 `codex/` 分支和源根以外、互不嵌套的绝对路径。也可使用事先按同样规则准备的新受管检出。以下变量只作示意，执行前替换全部占位，不把真实密码或 Key 放入命令：

```sh
QF_TARGET_ROOT='/绝对路径/全新恢复工作树/quiz-forge'
QF_FROZEN_REF='替换为本批已审查的准确提交SHA'
git worktree add -b codex/recovery-verification "$QF_TARGET_ROOT" "$QF_FROZEN_REF"
```

这一步只建立代码工作树，不复制源 `.cache`、node_modules、`.next` 或任何运行配置。然后进入目标仓库根核根目录、origin、分支和状态，执行 `pnpm install --frozen-lockfile`，再运行 doctor。目标 `codeSha256` 必须与本次备份的源代码身份相同；不同则停止，使用正确候选重新准备新目标，不能改写 manifest、摘要或历史迁移来绕过比较。Node/pnpm/PG 工具链保持匹配，不修改全局设置。

## 备份前后

1. 明确源 ID、用途 test/demo、准确工作树和代码；不能选真实作者实例作演练来源。
2. 源 HTTP、worker、请求和持久文件工作由其实际 owner 停止并证明结束，再禁用导入。空端口、租约到期和配置 disabled 均不能单独证明静止。数据库继续运行，以便取得受锁保护的逻辑快照。
3. 选择已存在父目录下的全新备份产物目录，不能嵌在源实例、源代码目录内或覆盖现有目录。工具不清理源残留、不重写历史回执、不替未知工作补造完成。
4. 工具只接受闭合 inventory 中的原始 archive、stopped 回执、blobs 与空目录；未知、临时、缺失、孤立或不匹配的文件导致拒绝。
5. 产物最多含 512 MiB custom dump、512 MiB 私有文件和 8192 项目录/文件。所有实际读取、写入、目录枚举均受有限预算约束；单次操作准入为 300 秒，超时后的已发起 cleanup 仍须实际等待。
6. 失败现场保留。没有最终 `seal.json`、存在 `seal.pending`、有额外条目或任意文件不匹配的目录不能恢复。最终标记通过原子 rename 发布；发布前所有 FD 已 sync/close。崩溃可能丢失最后未 fsync 的标记改名，此时目录仍按未完成拒绝，不承诺断电后必能保留成功标记。

应用停止与数据库停止是两个动作：备份阶段停止源应用/worker，源 PostgreSQL 保持运行。若源库原本已停，只能按受管命令启动已经核实的自有源 ID，再建立上述静止条件；不能为了空端口而停止他人的数据库。`p2a:db` 的管理参数使用分开的 `--instance ID`，与 recovery CLI 的等号参数不同。

```sh
# 以下均在源仓库根；源应用已由其实际 owner 停止。
QF_SOURCE_INSTANCE='替换为自有源的32位小写hex'
QF_BACKUP_DIR='/绝对路径/全新私有备份目录'
pnpm p2a:db status --instance "$QF_SOURCE_INSTANCE"
# 仅当核实该自有源已停且准备备份时启动：
pnpm p2a:db start --instance "$QF_SOURCE_INSTANCE"
pnpm --silent runtime:recovery doctor
pnpm --silent runtime:recovery backup --instance="$QF_SOURCE_INSTANCE" --out="$QF_BACKUP_DIR"
```

取得 `sealed` 后，将输出的 `manifestSha256` 存到备份目录之外、独立于备份传输渠道的私有维护记录，并与本次源 ID、准确代码身份对应。恢复时使用这份外置值；不能从收到的 `seal.json` 自报 SHA，或对收到的 manifest 临时算一个 SHA，再用它代替独立信任锚。传输备份时保留文件名、字节和 0700/0600 权限；工具验证的是自身目录产物，不接受任意 tar/ZIP、SQL 文件或源码作为恢复输入。备份没有加密，外部保管/传输需使用已批准的私有方案。

```sh
QF_MANIFEST_SHA='替换为独立私下保管的64位SHA'
pnpm --silent runtime:recovery verify --bundle="$QF_BACKUP_DIR" --manifest-sha="$QF_MANIFEST_SHA"
```

`integrity-verified` 之后源数据库仍可保留运行；本批演练期间源应用保持停止，不重新开放答题或运营写入口。维护命令不会替调用者恢复原应用，也不会自行认定业务接管完成。

## 隔离恢复与接管边界

恢复须在新的受管工作树根运行，目标根与源根不得相同、嵌套或互为祖先。目标 ID 目录必须不存在；明确选择与源不同且未被占用的数据库和应用 loopback 端口。保留源逻辑 ID、数据库/角色名称及不可变记录，重新生成目标数据库密码、物理路径和配置，不替换业务 JSON 或 checksum。目标默认 imports disabled，验证后停止保留；失败只停止本工具确实拥有的新进程，不删除现场、不覆盖重试。

数据库恢复不复制媒体运行时 authority。实际 HTTP 与媒体读取前，按仓库固定脚本为目标工作树重新 build/provision/setup 相匹配的媒体环境，不能复制源 control 文件绕过配置。

新端口不会隔离同 host Cookie，数据库密码更换也不会撤销旧 token。恢复副本不能自动成为同时接待同一用户的第二写权威。合成 HTTP 演练必须先停止源 HTTP，使用独立 browser context 与明确目标配置，再实际检查旧报告及资源、原进度和新 Key 完成，最后证明目标 HTTP/数据库停止。真实业务接管、凭证处置、生产迁移、部署或发布需要单独方案和授权。

## 恢复、手工启动、验证与停库

以下命令均从新目标仓库根执行。重新赋值的备份路径和 SHA 指向同一份已验证产物及外置记录；恢复目标固定为当前工作树，不接受任意覆盖路径。示例数据库 55426、应用 55427 只是演练端口，使用前核实空闲、与源不同，且符合当前任务端口归属；原 55423 和主控 3100 不属于本轮操作对象。

```sh
QF_BACKUP_DIR='/绝对路径/已验证私有备份目录'
QF_MANIFEST_SHA='替换为独立私下保管的64位SHA'
QF_SOURCE_INSTANCE='替换为该备份的32位小写hex'
pnpm --silent runtime:recovery doctor
pnpm --silent runtime:recovery verify --bundle="$QF_BACKUP_DIR" --manifest-sha="$QF_MANIFEST_SHA"
pnpm --silent runtime:recovery restore --bundle="$QF_BACKUP_DIR" --manifest-sha="$QF_MANIFEST_SHA" --pg-port=55426 --origin=http://127.0.0.1:55427
pnpm p2a:db status --instance "$QF_SOURCE_INSTANCE"
```

只在 restore 实际返回 `verified-stopped`、受管 status 确认 stopped 后进入下一步。这证明恢复时的迁移/schema/权限、23 表指纹及私有资源图通过比较，并且本次新库已停止；它没有启动网页、检查视觉、完成接管或发布。成功输出中的 `manifestSha256`、`databaseGraphSha256`、`storageSha256` 留在私有验收记录。失败则保留目录和证据，不重复覆盖同一个目标。

目标尚未启动应用时构建本工作树，准备自己的媒体部署和 helper，再 provision 封存。构建阶段不继承源 `QUIZFORGE_P2A_CONFIG`，不复制源构建或 capability：

```sh
env -u QUIZFORGE_P2A_CONFIG pnpm build
pnpm --silent media:build --main
pnpm --silent media:setup:macos --runtime-target=main
pnpm --silent media:provision --runtime-target=main
```

setup 只准备本树 helper，provision 才执行隔离验证并封存能力。若本树构建缓存使媒体部署超过既定上限，按受管构建流程清理本树 `.next/cache` 后重做媒体构建；保留失败结果，不删源私有目录、不放宽上限。媒体命令必须在离线独占条件下运行，不能与本树 HTTP/worker 同时修改运行时。

保持源 HTTP/worker 停止后，在目标根手工启动目标 PG，再在独立终端启动应用，明确指定目标 runtime 的绝对路径。这个路径按保留的逻辑 ID 推导；不复制源 runtime/admin 明文密码，也不使用环境中遗留的源配置。

```sh
pnpm p2a:db start --instance "$QF_SOURCE_INSTANCE"
QF_TARGET_ROOT='/绝对路径/当前恢复工作树/quiz-forge'
QUIZFORGE_P2A_CONFIG="$QF_TARGET_ROOT/.cache/p2a/$QF_SOURCE_INSTANCE/runtime.json" pnpm start --port 55427
```

浏览器使用准确 `http://127.0.0.1:55427`，不替换为 localhost 别名。使用新的 browser context，保管现有原始运营凭证和 Key 私密链接，避免共享源端 Cookie。恢复后的 imports 仍为 disabled；仅因测试方便不重新开启导入。

合成验收先保存 restore 的源/目标指纹相等证据，再通过真实业务接口检查：原完成报告与其图片字节、原 pending 的答案和进度、pending 继续并完成、原 unused 完成、旧报告在新写入后摘要不变。实际报告页还需点击产品 PNG 导出，核真实 1080×1920 文件与摘要，并保存有限安全截图供目视，记录视口、状态、浏览器和结论。需要证明运营写链时，使用恢复后台正常登录和新发 Key。后续合法操作会新增 grant/session/report/audit 等记录，目标完整表指纹因此可以变化；这与启动前的恢复相等证据分别记录。

验证结束，先由启动目标应用的 owner 正常停止应用，等待请求、媒体/资源工作和进程实际收尾；手工启动时在该终端停止并等待返回，不能仅凭窗口关闭或端口空闲断言全部 IO 已结束。自动演练使用其真实 server owner 的退出证明。然后从目标根停止准确的自有数据库并复核：

```sh
pnpm p2a:db stop --instance "$QF_SOURCE_INSTANCE"
pnpm p2a:db status --instance "$QF_SOURCE_INSTANCE"
```

最终应记录目标应用已实际退出、受管 PG stopped、相关端口无原 owner listener，以及本次工具拥有的 SQL/FD/子进程已关闭。保留目标工作树、PGDATA、配置、产物和私有证据；不自动删除、不重开源应用、不形成第二个同时接待用户的写权威。`status` 是受管进程状态检查，不能替代先前 restore 和业务验收证据。

## 既有凭证与时间边界

原始运营登录凭证、Key 私密链接由其原有持有人另行保管，备份内的摘要不能还原明文；浏览器状态不会迁移。目标数据库密码重新生成，只改变数据库登录，不撤销已有运营/消费者 token。凭证是否有效、已撤销、已过期，以及报告的只读访问权限，均继续由原业务规则判断。

备份和恢复不会暂停真实时钟、延长 Key/会话/grant 或重置完成状态。未使用 Key、pending 或 grant 过期后，不能通过修改 TTL、回拨时间、重放原记录取得完成权。正向合成演练优先使用新建的 7 日来源；旧过期来源可保留作负例。正式新发 Key 的完成证据单独记录，原 pending 续答仍以原授权有效为前提。已完成报告保持不可变，历史查看不重新评分、调用 AI 或再生成报告快照。

## 失败与实现接口

`RECOVERY_CLOSE_UNPROVEN` 表示至少一个关闭结果无法确认，本进程不能继续封存或恢复。保留现场及实际 owner，不通过等待 TTL、重置计数、忽略 late close 或自动重跑恢复资格。取消和截止时间不授予删除权限。修正原因后使用新操作/新目标；不得复用失败目标作覆盖恢复。

A 在创建任何目标前必须调用模块级 `assertVerifiedRecoveryBundle`。bundle 来自私有 WeakMap 认证，manifest 深冻结；JSON、spread 或 TypeScript cast 不生成权限。任意失败、取消或显式 close 永久撤销该能力。`withDump` 每次打开一个初始 offset 为 0 的只读 FD，hash 使用显式位置读取；A 只借用，等待所有 pg_restore 子进程和管道实际 close 后返回，由 B 关闭 FD。bundle 异步操作不允许重入：回调中可以调用模块级同步认证，不能嵌套调用 `bundle.assertValid()`、`withDump` 或 `installStorage`。能力不跨进程、不序列化、不缓存作后续运行权限。
