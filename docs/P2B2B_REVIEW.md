# B2-2B 审查记录

本页记录真实问题与关闭依据；合同前置审查不等于实现验收。

## 前置合同（基线844054c）

- P2：已有key重放若先检查当前平台，会在部署变更/平台guard未知时阻断原事务查证。主合同第4节改为当前授权+enabled后先exact K，命中不做platform/capacity/CAS准入；claim再次查询覆盖迟到提交。独立Astra在01a12e04-6373-7102-966e-94f15924d7c3闭合。
- P2：evidence_text非空而hash为NULL可使旧CHECK结果NULL而通过。新增双非空分支及整体IS TRUE；同轮独立复验闭合。
- 澄清：同fence允许lease清NULL，禁止设置/改变非空lease；空report_texts合法，非空才检查数组维度与下界；archive retry必须在claim前settled平台查询，claim后restore无平台调用，ESRCH不代替媒体停止。这些边界已通过同轮只读复验。
- 公共适配器：prepare/restore/SQL evidence projection复用A单一算法与预算；opaque prepared绑定同ctx且单次消费，restore不生成新报告，serializer按真实文本计量。前置未发现剩余可证P1/P2。
- UI独立Astra子代理复验：采用单bucket、有界UTF8、同步发送门与readback、exact tuple核实、空GET仍未知及compare-and-remove。旧receipt只用内存状态，不直接复用为刷新恢复；详情已写B2B_PENDING_UI。
- StartValidationResult增加record与严格preclaim not-started结果；通用HTTP错误不清pending。独立Astra在01a12e07-1e35-7060-9359-6233b7819b76已确认其与claim边界相容、无新增P1/P2。这里COMMIT边界专指validation claim，不禁止此前只读事务结束；未执行迁移/DB/native/build。

## 实施审查

公共代码已开始独立审查，仍无阶段验收结论。

- Root早审ad8a116：heldValidations的SELECT *会把1025条完整候选与报告搬入计量内存。4f09aba改为最小列，列表也只选摘要需要字段；strict asset-set与实际字节上限替代类型断言。
- Root早审ad8a116：validationKey的对象spread允许宽对象额外字段改变hash。4f09aba改为严格七字段Schema及显式canonical payload，拒未知字段与schemaVersion覆盖，边界用例通过。
- Root复验4f09aba：joined Product/id/version字符串排序与A逐id/version比较不等价，a及a-cover前缀可误拒。30d0bd6改为逐字段ASCII顺序并加合法/逆序/重复测试；root4项repository及3项DTO测试通过。
- V公共821bd296集成为1807559：prepare、opaque prepared、SQL serializer及engine scope抽取，root相关7文件66项纯测试通过；restore尚只有明确函数类型，无伪runtime桩。Astra首代码独立复验进行中。
- 新远端CI38197814487/38197842129为计费或支出上限阻断，job没有执行任何step；不当作代码检查结果。

### 公共适配UNKNOWN复验

Astra在首公共审查中用真实ctx复现：finite binding unavailable触发stop的同步abort listener可将ctx升级STOP_UNCONFIRMED，prepare及普通validate却沿旧局部状态输出无需维护。V de08f71→root d6f2030统一在最终completion、code和runtimeFailure吸收全局UNKNOWN；root42原相关测试与3个新增回归通过。独立Astra在01a12e1c-b89c-7c10-a7e8-b8cc5627586e重跑7个原/补充探针并关闭唯一P2，有限unavailable对照不变，迟到completion不降级；同轮窄读4718097 policy/ledger未见剩余P1/P2。此结论不替代FS/DB/实际媒体验收。

S操作内核3366443/76852da已集成68c2dd7/c1ffcc3，root11项纯测试通过；强制confirmed claim才可进candidate，receipt门核共享UNKNOWN，media unknown关联IO也保持unconfirmed。独立审查进行中；统一scanner/receive接线fee282df等待D迁移同批集成，避免缺表中间态影响旧receive。

### 归档完成前停止证明的合同补充

Astra在01a12e28-f467-7cf0-aeba-3d1b62294c2a确认receipt-before-complete可采用，并要求文件/媒体门、唯一receipt例外、一次DB finalization三个内部门；原业务期限不可借cleanup延长。主合同4.3已明确receipt只证明files-and-media，后继DB与连接关闭仍须观察，fixture不能凭此单独销毁活动请求。正常complete之后零文件/媒体IO；失败/取消receipt不新开事务。此为实施细化，不是新功能验收。

### 数据层与当前集成实证

- SQL独立审查发现按每个attempt无条件要求input snapshotted/identity bound会拒绝A合法interrupted evidence。86b5e4d→rootfa96d7d改为分支核绑定，unavailable仅有限interrupted，旧中断可与后续accepted共存；原Astra三个严格A合成实例与四条PG回归对应，原审查已窄复验关闭。
- client7c673f2、policy c838bbd、license9c8c299经独立Astra窄审未见P1/P2；只说明列举三表形状/有效app权限，不宣称全库ACL或迁移定义指纹。owner管理连接仍可升级旧库。
- root949a98a25d2720546a5d4005a748d3c6从0001–0008实际升级0009/0010；独立4文件26真实PG通过（.cache/b2b-domain-db.log）。升级前启用被明确拒且runtime逐字节不变；升级后启用/停用均成功，重跑migrate applied=[]；实例已停止。旧schema探针首次误读stderr为stdout而失败，修正探针后通过，没有修改业务来掩盖结果。
- root814fec3集成时全74文件939单元通过（.cache/b2b-unit-integration.log）；随后S文件/receipt增量12ed2bb的37项及U18ea20b的46项分别通过。它们不是本批最终完整回归。
- 原receipt微任务P2在7f82205/59c7947经独立Astra关闭，排队后UNKNOWN或新pending均零work；V restore e0a2fe0经30探针与相关既有测试复验未见新P1/P2。12ed2bb新增三门/实际receipt及U公共流程仍在独立审查。

### 后台请求证明复验

U b2486a4首批独立46纯测试通过，但旧not-started对象只绑定tuple，能在exact row清除后误删同tuple新发送的unknown。a37144b→rootd87d993用每次发送的incarnation token绑定证明，新发送与权威row接管撤销旧资格；独立重跑原四步得到oldProofRejected/newUnknownRetained且pendingCount=1，原P2关闭。root修后47纯测试通过；实际页面/路由/浏览器验收尚未交付，不计为UI阶段完成。

### 文件证明发布与数据库完成门

独立Astra在01a12e3a-09c3-70f0-b1da-999055f4920c复现两个P2。其一，最终receipt文件已可读不代表publisher后续unlink/fsync/close结束：延迟目录close时读端已接受nlink=1文件，而writer仍pending，超时后仍可读；只禁止nlink=2不足以关闭问题。当前文件只能作为非权威candidate，不能单独授予recover release；持久化确认合同正在修订。

其二，封门后普通databaseAwait(write)可绕过finalizeDatabaseOnce，且排队finalize在实际work前不复核共享UNKNOWN。12f8b1a→root7c16a46禁止封门后普通新write，并在finalize实际work前排除仅自身pending任务复核资格；单次门不恢复。root定向operation20项通过，独立复验及ack整合仍待完成。

后台73e2ef3/130c29c已集成为c7e1deb/6502b94；root与operation合跑5文件77项通过，类型通过。独立UI预审指出通用IDENTITY_CHANGED或storage错误不能描述为“未开始/未发送”，以及刷新列表期间可能临时回显旧summary，U正在整改。实际routes、factory、浏览器验收尚未完成。

### ACK修订决策

Astra在01a12e46-6d82-72d2-b4cf-a4d05b5dbc0c确认采用非权威candidate receipt+独立DB ACK：全部publisher IO settled后才有原请求私有资格，ACK失败/未知禁止原complete；recover必须同时核已提交proof和文件。主合同3.2/4.2–5及迁移节已改写，不再保留单文件release或ESRCH替代ACK。policy v2增加56KiB metadata准入以预留8KiB最终controls。先0011提交审计enum、再0012保护协议，旧0010不改。该决策已冻结供实现，尚无代码/DB验收结论。

Astra在01a12e4a-87a8-7a00-9cfb-d99b05b3f5df进一步确认0011枚举/0012协议分开提交，以及ACK后共享一次complete|interrupt终结门均无架构阻断；interrupt不得新增IO或猜clean，A已stop的interrupted不复活。U两P2由5dd987e→root4abc51c整改，59纯测试通过，独立闭合待核。

Astra在01a12e4f-4e79-7ae3-b0a4-32a36614b5d4独立复验4abc51c：actual flow/client/messages的generic identity变化与POST成功后removeExact失败均保留mayHaveBeenSent并只说待核实；strict not-started对照仍需显式放弃。actual panel/use-read模拟调度经过刷新失败、翻页、迟到旧详情/列表和低revision显式读取，维持最高rev4 ready且无旧recover；loading/error禁写。45既有纯测试及11时序探针通过，两P2闭合，无新P1/P2；不替代真实浏览器。

D f73f415→rootd71f1ad已集成ACK公共/事务首接口，尚等0011/0012及domain fixture适配。该中间head类型检查有3个旧SettledAttempt夹具缺fileStopProof，已交D适配，未记作检查通过。S e515e34→root189853e补齐已排队ordinary write实际work前封门重检，21项定向operation通过；ACK整体独立复验另行执行。

### ACK数据迁移及独立总控回归

6811e43→root11f6ed0完成0011/0012、旧v1只读兼容及fixture适配，root类型与12文件131定向测试通过。自有949a98a25d2720546a5d4005a748d3c6实际0010→0011/0012升级，启用/停用正常、重复migrate applied=[]，6文件34PG全部通过（.cache/b2b-ack-domain-db.log），实例已停止。该次包含独立合成无文件的10→仅11拒app→12及旧9字段保留/拒ACK/complete/retry，不把合成SQL proof当FS停止证明。

Astra公共审查01a12e52-b3b0-71f1-9558-f75561d7306b发现retry遗漏旧policy保护，6811e43加requireCurrentPolicy；独立Astra子代理已窄复验关闭，21其他公共探针/7既有测试为前轮证据。本轮SQL/helper摘要6/6及当前policy hash一致，但新增P2：client触发器早检没有核tgqual/tgattr，WHEN(false)可同名同函数却不执行。D正在补无条件/无列过滤/无参数检查与PG回归；未给本批无问题结论。

S 44f2d6d→root984e9b8集成candidate.v2、原请求私有publication资格、单次ACK→互斥finalize、StorageLock实际pending观察。root operation/receipt/storage共50项及storage-lock9项通过；独立真实FS/门/旧调用兼容审查进行中。factory与helper仍未交付，不作完整服务验收。

11f6ed0时全量81文件1040单元通过（.cache/b2b-ack-unit.log）。trigger P2由e96a77d→rootaba7690修复，无条件/无列过滤/零参数及非constraint/partition/transition限制补齐；原Astra子代理窄复验关闭，无新P1/P2。root在自有0012库独立13项client PG全过（.cache/b2b-ack-client-db.log），随后stop确认；类型/lint通过。该补丁未改0012。

### S ACK来源与关闭包装层复验

Astra在01a12e57-e418-7ae2-a34e-4a89eaf1d5be重跑原真实FS探针：最终dir close迟到/超时、nlink2后UNKNOWN均无ACK资格，未持久proof的reader返回null；普通write绕过/排队UNKNOWN均零work。原两P2关闭。真实patched driver+内存transport的150个pending/保留queue以及握手前reserve在end后2–3ms全settled，未发现新增可证旧StorageLock drain deadline问题；仍不替代真实网络回归。

新增两P2继续交S：旧CANCELLED cleanup candidate能被新operation的existing/EEXIST路径采纳并登记publication资格；必须拒绝从既有文件补原publisher资格。closeStorageLock清空lock却未同步撤销业务资格、重复调用不等原关闭，ACK后关闭仍可finalize；须同一cached close task、同步封门、有效锁重检。48原定向与额外门/FS/driver探针通过不代表这两项已关闭，factory尚未交付。

### 完整应用接线与服务异常闭合

S cfe6bf4→roota34ee1b交付真实service/recovery，13纯服务测试与类型通过；U efc2139→root4c86904交付5 API route文件/只读详情及imports独立验证组合，root10文件114相关纯测试/类型通过。实际DB服务与生产浏览器尚未验收。

S旧candidate补资格由98884e9→roota1ef966经Astra在01a12e61-d479-76a2-80b2-58d29843d964独立关闭；同轮又发现closeStorageLock在同步abort listener重入前未cache，63dd30c→root26a7458先cache/track共同deferred再广播。Astra在01a12e69-f3e7-73f2-9f1c-422bd0c1024a对preclaim/ACK确认两阶段原探针确认三个调用同promise、真实close暂停时均未返回、只close一次且不能finalize；30既有测试通过，该底层登记问题全部闭合。

service独立审查发现evidence/beginArchiving WRITE_OUTCOME_UNKNOWN会继续activeFailure→ACK/interrupt，原probe实际ack1/interrupt1且伪record。bfc822f→rootddf195f将已进入work的write拒绝统一同步stop并永久使原DB失效、追踪end；保留原UNKNOWN。独立重跑原evidence和新增archiving两个实际service/operation纯probe，ACK/interrupt/promotion均0且无record，db.end1；新context也不能重用该DB。两自有探针及47定向通过，原P2闭合。

### 构建追踪准备

root首次main生产build在ddf195f成功，59 trace/21762路径/0私有违规，但新实际路由拉入媒体闭包后有5处whole-project动态FS tracing warning。Sol独立e4ce925仅在受限mac依赖解析、六固定sharp root与私有manifest操作的精确参数加turbopackIgnore，运行时表达式/校验与tracing guard不变；3文件95测试/类型/lint通过，root重新build中。main隔离setup已prepared，不代表新的部署已bind/seal或实际媒体通过。

e4ce925的root实际重建已成功，零warning，59trace/11357路径/零私有违规。首次main绑定因生成的Turbopack缓存单文件44,407,641字节触发LIMIT_EXCEEDED，未提交绑定。Astra在01a12e75-a0f9-7f30-bdb8-3b770ec70d47批准保留迁出无运行引用的生成缓存；root离线预核精确16文件/87,843,260字节与inode后迁入独占0700私有目录，前后1143个server/root产物摘要相同。未扩大生产限额。随后main绑定成功：1033 source文件、675 artifact文件、总32,279,447字节，hardening检查1218文件/237目录。保留首次失败与私有缓存清单。

### main实际隔离与夹具审查

首轮实际main矩阵完成66项，65通过；BUSY用例未等原任务实际spawn且仅800ms，失败导致未签发record/capability，原失败保留。root另核自有native进程和control均为空，未删除未知记录。49f4072增加原owner的spawn屏障，两个调用共享固定5000ms，finally无条件abort并实际await原任务，BUSY/原identity/confirmed断言不放宽。独立Astra子代理跑25既有纯测试及五分支闭集probe，无P1/P2；完整三轮仍待实际重跑。

E2E私有helper a45c946→root93db565首审在01a12e7a-fd60-7610-9627-f4321471883b发现两P2：cleanup的operation绑定已关闭app连接而实际维护SQL使用owner连接，无法在取消时停止真正写任务；按fixture actor删除全部audit未先排除其跨Product业务目标。S负责修正实际owner生命周期及删除前完整归属核验，同时补prepare临时启用/确认后停用。16纯合同测试通过不代表维护全流程通过；本轮未实际运行helper。

49f4072后root实际main三轮均66/66通过，provision返回sealed、capabilityCommitted=true、recordCommitted=true；对应部署c7ca75ffbb29ae294f8eecc75e449fae8170e395241978e96772c75ee8e11e15。随后在351e8d1执行格式/lint/类型、82文件1060单元、43离线工具均通过；自有55423启动后46真实驱动故障场景全部通过。首次失败没有改写。

61f985c→root9bb0a90补prepare临时enable/确认后disable；255fe59→root3e3d913集成8项serial生产E2E，类型与列举28项（含20依赖）通过。root先独立执行8项，前后只prepare/enable/disable，不调用仍有P2的cleanup；测试现场保留到Next实际退出且维护审查关闭。S共享fixture与Sol独立service PG仍在实施，不能将上述增量当完整阶段回归。
