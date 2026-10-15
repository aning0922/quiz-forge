# P3-C A 实施证据

2026-10-16，基于冻结共享合同 c3fdd8ce5d9b8ea0f5763ae9d961f4a161c79494，分支 codex/p3c-preview-service。

## 里程碑一：授权与固定 source

已实现独立 POST CSRF + studio:read，只调用既有 read 三参数；不接写能力、withStudioWrite 或写 UNKNOWN 语义。固定 revision 正文/asset-set 先核有界实际字节、SHA、规范 JSON、严格内容与完整引用，再核 exact product_asset 声明与 blob 元数据。资源 resolver 只取固定 asset-set 与精确一项资源，不取正文/evidence，不要求 alias 首来源等于本 revision 的 source_validation_id。入口和临时评分服务接冻结 PreviewProjection DI；完整 JSON 成功封套经共享 Schema 与字节预算核验，发布前新事务重新授权。

实际检查：新增 repository 单测 9 通过；自有端口 55421、purpose=test 隔离 PG（instance b03fce54a628fb595397f6cb35d78e07）新增服务/来源测试 7 通过。PG fixture 使用真实候选构造与事务，但媒体 evidence 明确为 synthetic、无文件，不代表 native 媒体验证。覆盖 read-only、不更新 idle expiry、固定 revision/完整 Ref、合法 alias、当前 session 撤销/operator 禁用、CSRF 与 hash 先于 projection、v1 原文仍可读。

类型检查、变更范围 ESLint、Prettier 与 diff 检查通过。尚未接 B 真实投影、真实 API 组合；未执行完整构建/E2E/视觉验收。资源文件/共享锁/取消和 server owner 证明属于下一里程碑，尚未宣称完成。

## 里程碑二：共享读锁、资源 IO 与受管退出证明

新增私有 `StorageReadGuard`，在独立 max=1 reserved pool 上实际取得同 key `(72461,2)` 的 session ShareLock，并核本 backend 的 ShareLock；旧 `StorageLock` 未修改。资源入口四槽、零队列，完整 FD 读取与已验证 Buffer 响应共用同一槽；取消/超时只关闭业务门，实际 open/read/stat/close 继续被真实 Promise 收口，晚到 FD 必须关闭。完整文件先核私有祖先、UID/mode/nlink、NOFOLLOW/NONBLOCK、前后 dev/ino/size/mtime、实际 bytes/SHA/MIME，再发已验证内存。单块 64KiB、高水位1，body 完成/cancel/error 才还槽，15s timer 延伸覆盖 body。close 明确失败时保留 FD/guard 引用与槽直到进程退出，不用 TTL 伪造结束。

新 test-only owner 位于 `tests/support/p3c-server-owner.ts`。实际 launch 的 ChildProcess/close 与自有进程组由私有 WeakMap 持有；停止后只有真实 close、组严格 ESRCH、端口可绑定才签发绑定 cwd/instance/run/launch 的私有 proof。无序列化 proof、未知 PID 接管或 timeout-resolve 的 close 事实。

新私有 fixture 文件为 instance 目录 `preview-p3c-e2e-fixture.json`（0600、≤16KiB），Schema/type 和 prepare/read/finish/cleanup 位于 `tests/db/p3c-preview-fixture.ts`。两个 source 分别 archetype/dimensions，使用 run 专属原始合成像素，显式 `synthetic-db-and-private-pixels-no-native`；不授予 native 或商用素材资格。CLI 仅 prepare/finish，不输出秘密、不提供 cleanup；cleanup 只接受 owner 同进程真实 proof，且 writer PID 必须严格不存在、completed、imports disabled、真实身份/旧独占锁、无其他 backend、无 held attempt、原生 control 空、精确来源/ACK/actor/audit/文件hash/外部引用均通过才删除。外部借用 blob 不删除；新建 blob 发现外部引用则保留并失败。

实际验证：resource-read 单测18项通过（含 close 未确认后的 quarantine 额度保留）；真实PG共享锁3项通过；真实Node owner3项通过；PG+真实私有FS+直接HTTP服务7项通过，包含四个未消费body占槽、第5个503、实际晚open取消后FD关闭、文件核验后真实撤权由新事务拒绝、损坏文件不发图片、HEAD/Range/hash不符、完整像素响应及无ETag/304。其fixture在真实prepare子进程退出后，经实际owner proof与上述检查精确清理成功。该直接HTTP测试没有启动Next或浏览器，不冒称E2E/视觉通过。B真实projection/API组合及主控3100仍待接入。

## 真实投影、路由与生产网络探测

B 的原始提交 `8326aba30c5dd83c980c9da5c83bab51b1c434dc` 在本分支同步为 `24880e1`；此提交是 B 依赖同步，不作为 A 新开发重复交付。A 的固定 API 三路由现组合真实 `preparePreviewContent/scorePreview`；新增真实 PG/route 测试6项通过，分别覆盖两实际引擎的3结果 witness、实际选中卡/报告/portrait、规范答案 hash、无持久化改写、预揭晓最小传输、POST CSRF、全绑定不符、缺答/重复/跨题/未知选项拒绝。HTTP传输独立边界单测18项通过，错误封套用服务端观察 ID、临时计算不产生写 UNKNOWN。

已实际运行 `pnpm build`，production Next 三API编译成功，`BUILD_TRACE_OK` traceCount=68、pathCount=13952、violationCount=0。新增 `tests/db/p3c-next-probe.ts` 在自有 purpose=test/3112 上以真实受管 Next production 子进程完成网络探测：read-only 真实登录、两个 entry、四次完整图像字节/SHA、两引擎共六组真实 witness 评分、HEAD/Range/无ETag行为；输出 `P3C_NEXT_PROBE_OK`（entries2/images4/scores6/engines2/browser=false）。随后真实stop/proof、finish子进程及精确cleanup均成功。入口拒绝主控3100，未使用浏览器，不替代主控E2E/视觉验收。

全仓 format/lint/typecheck/unit 与普通PG完整回归正在当前路由head复验，最终结果另补。`pnpm test:e2e` 与四宽六状态截图由主控独占3100串行集成；A不执行主控端口任务。

当前路由head最终本地回归：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test` 全部通过（117 files / 1478 unit）；普通 `pnpm test:db` 全部通过（42 files / 382 tests，172.70s）。自有 b03fce54a628fb595397f6cb35d78e07 / 55421 已正常停止，Next probe 子进程与夹具已完成真实退出和精确清理。未执行主控独占 `pnpm test:e2e`，未宣称远端CI/浏览器视觉成功。

环境差异已交主控冻结窄策略：普通 CI database job 没有 provision 平台 native runtime/control 目录，单独执行不能依赖其他旧测试先建目录。主控随后报告普通集成 CI 38796115166（97f07d5）与 38794366475（4c2f921）实际 success，因此这是测试独立性/执行顺序边界，不是已发生的 CI 失败。A没有创建替代 control 或改动 CI，具体收口见下文。

## 独审整改及独立无 runtime 场景

owner竞态整改已独立提交949d932：同步占用cwd/instance/run身份后才进入异步portFree；失败/未知身份不退还。新增并发真实child与端口失败重用两项，owner5项通过。并发测试只延迟真实net.Server.close以保证观察原异步窗口，实际端口关闭、ChildProcess.close、组不存在与proof均真实；把实现临时换回旧顺序后该并发回归实际失败，恢复修复后全部通过，所有测试子进程均已收口。

新增test-only `p3c-native-control.ts`，仅对qualification严格等于synthetic-db-and-private-pixels-no-native的本批夹具生效。先核cwd/.cache/quizpack-media-runtime已存在祖先的真实目录、owner、无symlink与实际realpath；只有当前平台stateRoot的严格ENOENT返回not-provisioned。任何EACCES/ENOTDIR、悬空symlink或未知错误均拒绝。stateRoot存在则要求0700/owner/无symlink及原control0700/身份/空目录前后核验；缺control/非空/错误mode照常拒绝。cleanup在最初和删除前实际重复检查，返回明确 `{nativeControl:"not-provisioned"|"empty"}`；not-provisioned不称native通过。旧B2/B3及生产native检查未改，也不创建空control替代证据。

无runtime检查新增11项实际隔离FS测试，包括全新根（连.cache都不存在且检查不创建它）、现存祖先、平台根出现后缺control、正常空control后变为非空、目录mode/文件、各层悬空symlink和未知qualification拒绝。FS读取单测另显式创建其自有私有测试base，避免依赖之前数据库初始化；不修改已有目录权限。

ece2f0c 整改后复验：全仓format:check/lint/typecheck与117files/1478unit再次全部通过；owner5＋原生目录11＋真实PG锁3＋PG/FS直接HTTP7，共26项定向通过。完整普通PG的42files/382是上文e9adeec基线证据；没有把新增用例后的总数冒称已全量复跑。自有55421实例status再次确认为stopped。949d932/ece2f0c已分别交主控独审复核；最终集成CI、3100浏览器E2E及视觉/作者审核仍归主控，不在此声明通过。

## 集成 E2E preauth 预算收口

主控首次完整E2E旧222项通过，preview prepare在第二身份认证前失败。只读现场确认operator有1次login、read-only无login，创建时前60秒成功preauth已有20次；源码createPreauth的真实20/min限制与此吻合。自有a3109446dbab1b21d332c0e4879fc2c0/55421实际复现：真实B3 completed后先填窗口19次，旧prepare operator变第20次，read-only返回RATE_LIMITED，留下prepared=false/sources0/产品0。该失败现场已正常停库保留。configureImports没有全局blob物理扫描，此次失败尚未进入source/candidate/native构造，不删除该调用或调整suite顺序。

新增test-only p3c-auth-budget，仅CLI prepare在首次写私有fixture前，只读真实DB等待旧成功preauth窗口清空且outstanding<100；原起点等待预算61s，DB只读事务statement2s/transaction5s，每次等待后重新查证。超预算、100未过期、事实错误或DB错误都有限失败；不会重试未知认证结果，不改20/min/100阈值、不删audit、不改时钟、不签发session。满足后仍执行真实createPreauth/login。普通preparePreviewFixture直接调用不等待；去掉未使用readOnly bootstrap login，保留readOnly actor/凭证，后续仍由浏览器实际登录。CLI prepare子进程timeout90s，finish原30s不变；本线PG资源测试beforeAll相应局部95s上限，fresh窗口不增加等待。主控/B另同步其prepare helper90s，finish原值不变。

自有新purpose=test实例5d36d9c030da693aa10d6e7c4919b09b/55421真实验证：B3完成＋窗口19后，修复CLI prepare耗时60407ms，prepared=true/source2；readOnly bootstrap login0，随后首个真实readOnly preauth/login成功，当前窗口2；成功preauth历史总数19→21，旧B3私有fixture hash未变。没有把等待当认证成功，没有browser/Next声明。成功与失败复现现场均保留并正常停止；root aab现场未改。

新增7项gate边界覆盖fresh立即通过、整窗等待后重新观察、并发新增请求再观察、100 outstanding超过一窗有限拒绝、原deadline不重置、非法事实/非test拒绝及DB查询耗时计入预算。
