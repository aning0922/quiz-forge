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
