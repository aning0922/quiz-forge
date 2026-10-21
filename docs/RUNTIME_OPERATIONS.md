# R1 受管本地环境维护

适用合同见 `RECOVERY_R1.md`。本文件记录 R1 工具的操作边界；完整真实恢复与 HTTP 演练仍须以阶段验收证据为准，不能用文件测试或 doctor 结果代替。现有 39eb、作者资料、原工作树和归档标签保持原位，开发演练只使用新建合成 test 实例。

## 环境与凭据

备份/恢复支持 macOS arm64、固定 Homebrew PostgreSQL 18.4 及项目声明的 Node 版本。命令必须从正式 origin 的独立受管仓库根执行，先用冻结锁文件安装依赖。doctor 仅检查仓库、工具链和代码字节，不连接业务数据库、不读取用户资料、不启动服务或配置媒体运行时。包完整性校验不需要启动 PostgreSQL；Linux 工具测试不等于 Linux 恢复支持。

代码摘要包括合同中的六个根配置文件以及 `src/`、`scripts/`、`migrations/p2a/`、`patches/`、`public/`。上限为 16384 个文件/目录项、单文件 32 MiB、总文件字节 256 MiB、摘要清单 4 MiB；超限拒绝。依赖目录、构建、文档、测试和 `.cache` 不参与摘要。摘要不是 Git SHA，也不验证 node_modules 或未登记原生工具。恢复目标需使用同一实际代码字节和相匹配的冻结工具链。

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

## 备份前后

1. 明确源 ID、用途 test/demo、准确工作树和代码；不能选真实作者实例作演练来源。
2. 源 HTTP、worker、请求和持久文件工作由其实际 owner 停止并证明结束，再禁用导入。空端口、租约到期和配置 disabled 均不能单独证明静止。数据库继续运行，以便取得受锁保护的逻辑快照。
3. 选择已存在父目录下的全新目标目录，不能嵌在源实例内或覆盖现有目录。工具不清理源残留、不重写历史回执、不替未知工作补造完成。
4. 工具只接受闭合 inventory 中的原始 archive、stopped 回执、blobs 与空目录；未知、临时、缺失、孤立或不匹配的文件导致拒绝。
5. 产物最多含 512 MiB custom dump、512 MiB 私有文件和 8192 项目录/文件。所有实际读取、写入、目录枚举均受有限预算约束；单次操作准入为 300 秒，超时后的已发起 cleanup 仍须实际等待。
6. 失败现场保留。没有最终 `seal.json`、存在 `seal.pending`、有额外条目或任意文件不匹配的目录不能恢复。最终标记通过原子 rename 发布；发布前所有 FD 已 sync/close。崩溃可能丢失最后未 fsync 的标记改名，此时目录仍按未完成拒绝，不承诺断电后必能保留成功标记。

## 隔离恢复与接管边界

恢复须在新的受管工作树根运行，目标根与源根不得相同、嵌套或互为祖先。目标 ID 目录必须不存在；明确选择与源不同且未被占用的数据库和应用 loopback 端口。保留源逻辑 ID、数据库/角色名称及不可变记录，重新生成目标数据库密码、物理路径和配置，不替换业务 JSON 或 checksum。目标默认 imports disabled，验证后停止保留；失败只停止本工具确实拥有的新进程，不删除现场、不覆盖重试。

数据库恢复不复制媒体运行时 authority。实际 HTTP 与媒体读取前，按仓库固定脚本为目标工作树重新 build/provision/setup 相匹配的媒体环境，不能复制源 control 文件绕过配置。

新端口不会隔离同 host Cookie，数据库密码更换也不会撤销旧 token。恢复副本不能自动成为同时接待同一用户的第二写权威。合成 HTTP 演练必须先停止源 HTTP，使用独立 browser context 与明确目标配置，再实际检查旧报告及资源、原进度和新 Key 完成，最后证明目标 HTTP/数据库停止。真实业务接管、凭证处置、生产迁移、部署或发布需要单独方案和授权。

## 失败与实现接口

`RECOVERY_CLOSE_UNPROVEN` 表示至少一个关闭结果无法确认，本进程不能继续封存或恢复。保留现场及实际 owner，不通过等待 TTL、重置计数、忽略 late close 或自动重跑恢复资格。取消和截止时间不授予删除权限。修正原因后使用新操作/新目标；不得复用失败目标作覆盖恢复。

A 在创建任何目标前必须调用模块级 `assertVerifiedRecoveryBundle`。bundle 来自私有 WeakMap 认证，manifest 深冻结；JSON、spread 或 TypeScript cast 不生成权限。任意失败、取消或显式 close 永久撤销该能力。`withDump` 每次打开一个初始 offset 为 0 的只读 FD，hash 使用显式位置读取；A 只借用，等待所有 pg_restore 子进程和管道实际 close 后返回，由 B 关闭 FD。bundle 异步操作不允许重入：回调中可以调用模块级同步认证，不能嵌套调用 `bundle.assertValid()`、`withDump` 或 `installStorage`。能力不跨进程、不序列化、不缓存作后续运行权限。
