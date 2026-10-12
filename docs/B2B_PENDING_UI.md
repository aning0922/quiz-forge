# B2-2B 后台待核实请求合同

本文件是 [B2-2B 合同](STUDIO_P2B2B.md) 第7.1节的组成部分，状态随主合同。采用独立Astra只读复验建议；开始响应严格采用主合同StartValidationResult，不复用旧receipt错误码猜测未提交。无额外账户/跨tab协议，不扩大旧原包上传流程。

首次操作为显式“验证并归档”，允许其内部串行prepare→false持久化→true同步发送；不强制用户理解或手抄key。false刷新后需显式继续或取消；true只读核实。not-started只能由主合同的preclaim服务证明发行，HTTP/UI不能猜测。

## 最小存储形状及严格读取

```ts
type PendingTuple = {
  productId: string;
  importId: string;
  expectedImportStateRevision: number;
  archiveSha256: string;
  archiveBytes: number;
  identitySha256: string;
  expectedValidationKey: string;
};
type PendingEntry = {
  tuple: PendingTuple;
  mayHaveBeenSent: boolean;
};
type PendingBucket = {
  schemaVersion: "quizforge-validation-pending.v1";
  entries: PendingEntry[];
};
```

- 固定 origin 内一个 sessionStorage key；所有对象 strict，拒未知字段；ID/hash/bytes/revision 复用 browser-safe 合同；不让 storage 数据选择 URL、HTTP method、路径或策略。
- 同 Product/import 恰一项；相同 pair 不同 tuple/key 冲突时保留旧项并阻断，不覆盖。完全相同项是本地幂等，不等于可再次发送。
- entries≤16；每个序列化 PendingEntry UTF-8≤4096 bytes；整个序列化 bucket（含 envelope/标点）UTF-8≤65536 bytes。16×4KiB 不等于忽略 envelope 后仍可超 64KiB。
- 读取先以 string.length≤65536 作廉价拒绝，再核 UTF-8 总字节并 parse/schema 校验；不能先 JSON.parse 无界数据。写入使用固定字段顺序的JSON序列化并完整readback；类型/限额/重复pair校验必须。
- getItem/setItem/readback 任何异常、未知版本、损坏、超限、重复 pair：保留原内容，禁止新的 prepare→start 流进入发送；提供有限“本标签的待核实记录不可读取”说明。不要 reset 为 [] 或 LRU 淘汰，不引入自动迁移/清空按钮。
- 首批无 TTL；客户端时间不作为放弃未知请求的理由。只改本 bucket，不 sessionStorage.clear()。
- readback 必须比较完整预期 bucket/entry；失败即零 fetch。存储中若实际上已成为 true，下次读取按 unknown 处理，不以本次 setItem 异常回滚它。

## 生命周期

| 状态                              | 允许操作                                                                                                                   | 禁止/离开依据                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 未准备                            | 读取服务器 import/历史，用户显式 prepare                                                                                   | 不因页面 mount、轮询或 StrictMode 自动 prepare/start                                                                                   |
| prepare 在途                      | 独立一次 60s；响应校验 Product/import、received 原包事实、revision 和 strict tuple                                         | 无 claim；prepare 响应丢失不称 validation unknown。只能显式再 prepare，不伪造 tuple                                                    |
| prepared=false                    | 完整 tuple 先入 bucket，允许确认、取消或显式 start                                                                         | 当前页面不可变 tuple；取消仅对此 false 且没有同步发送门已开启的项                                                                      |
| 写前临界段                        | 同步获取 pair busy gate，重读 bucket，核对 pair/完整 tuple/false；改 true，检查全部限额、setItem、readback，最后调用 fetch | 任一步失败零发送。prepare 异步旧响应不能覆盖已有 pair；不可在 read→write 中 await                                                      |
| mayHaveBeenSent=true / 在途或未知 | 禁用 prepare/start；按原 pair/key GET，或等待这次 POST 响应                                                                | reload/卸载/AbortError/网络错误/响应解析错/不匹配/未知提交/服务超时都保留原项；不重建 key，不自动 POST                                 |
| GET 0 条                          | 保留 true，说明暂未找到不证明回滚，允许再次显式 GET                                                                        | 不解锁 start/prepare，不静默清除，不以时间过期放弃                                                                                     |
| 权威 exact row                    | 完整验证响应后采用服务器 row，展示其真实状态；按 compare-and-remove 清除此 exact tuple                                     | row 可以仍 validating/unknown；清除仅表示已获得 durable row 锚点，不表示成功/停止/配额释放。此后走该 row 的 GET/recover/retry 显式流程 |
| 确定拒绝                          | 仅受审 start 错误分类确证本次未 claim，且本 tuple 没有更早未知发送时，允许用户明确放弃该次准备                             | 普通错误码不够；401/403/404/timeout/异常断连默认保留。先前 unknown 不可被后来的某次请求拒绝抹掉                                        |

准备后持久化 false，这样刷新仍能展示原准备；只在真正 start 临界段改 true。本批采用false→true两步；仅显式操作继续，刷新不自动开始。

## 精确 GET 和响应检查

- 路径从当前受信任 route pair 生成；query 固定 `validationKey=expectedValidationKey&page=1&pageSize=1`，无 status 过滤，no-store，同源凭据。
- Page 必须 strict，page=1/pageSize=1、total=items.length∈{0,1}、hasNext=false；出现多项、tuple 不符、非法 DTO 一律不采用、不清除。
- row 必须匹配 productId/importId/validationKey/archiveSha256/archiveBytes/identitySha256。不只看 key 或 validationId，不用列表里“最新一条”替代。
- 不要求当前平台 identity 等于旧 tuple；旧 key 的读取/replay 正是用来跨平台代码更新核实旧事务。不能复用新的 prepare 覆盖旧 identity。
- POST 的 201/200 同样 strict 检验 full immutable tuple，分别真实首次/已有行 replay；接受 rejected DTO 是服务器业务事实，不同于“根本没 claim 的拒绝”。
- API 的 current validation stateRevision 不能等于或替代 expected import revision；清除时不拿其大小决定 tuple 是否过期。

## 并发、错误及权限

- 一个小的浏览器模块提供同步 `read / addPrepared / markBeforeStart / removeExact`；不让多个组件各写 bucket。所有 mutation 临执行重读当前 bucket并严格校验，避免 async response 用旧数组覆盖其他 pair。
- React 组件用 ref/同步 gate 抑制连击；模块级 pair gate覆盖同文档两个组件。JS 同步临界段内没有 await，持久化成功后发出一次 fetch，再解锁 busy 不等于撤回 mayHaveBeenSent。
- 每个 prepare/read/start promise 捕获不可变 tuple 与页面 generation；迟到响应只能更新其捕获 pair/key，不能改当前导航后的 Product/import，也不能移除后来不同 tuple。删除使用完整 tuple compare-and-remove，不写回捕获的旧 bucket。
- 已有 entry=true 时即使网络请求已不在内存，也只读；duplicate tab/opener 复制 storage 不授予自动重发权。跨 tab 的仲裁仍由服务器唯一约束/replay/CAS保障，不新增跨 tab 协议。
- 权限、归档、enabled 变化均不删除 pending。read-only/禁用仍可按当前 studio:read 核实；401后保留并登录后核实。logout 不清除 unknown、不把 CSRF/session token 作为 bucket key 或 tuple 字段。
- start 错误需服务团队给定有限 phase/outcome 分类：claim 前已知未提交 vs 已确认/未知提交后失败。不能直接复用 receipt 的 knownErrorStatuses/`isUnknownWrite` 判断清除；尤其 OPERATION_TIMEOUT/LOCK_LOST/STUDIO_UNAVAILABLE 可能晚于提交。
- 即使采用明确 preclaim 分类，它只证明对应请求；不得用重发收到的拒绝消除更早 unknown。首批： true 项无重发入口，未定义清除语义的错误一律保留。
- bucket 无法读取时，已有本组件不可变 tuple 可供当前会话手动 GET，但不得凭内存绕过存储失败开始新 POST；刷新后不能假称还能恢复未读出的 tuple。

## 敏感信息与有限可用性

仅保存 UUID/工作区稳定 ID、整数和 SHA/key；validation key 是查询/幂等锚点，不是授权 bearer。服务端每次当前 auth+Product/import 归属检查，浏览器 bucket 不能授予访问或写权限。
不存 cookie、CSRF、operator credential、owner PID/nonce/fence、服务器路径、原包/资源字节、报告/声明全文或标题等内容；不输出完整 bucket 到日志、错误遥测或截图。
只在经过认证的 Studio UI 展示 pending；采用服务器权威状态前，存储内容始终是不可信恢复提示。无需新增账户命名空间/跨账户模型，当前全局角色权限维持不变。
未知满16项时保守阻断；无自动淘汰/GC。系统运维层清浏览器数据会丢失本地锚点，不能在本批添加“忘记所有未知”假恢复按钮。

## 最小验收与所有权

| 检查                                                                                             | 证明方式                                                                         |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| strict bucket/未知版本/非法重复/16项/每项和总UTF-8边界/QuotaExceeded/getItem异常/readback不符    | 纯模块单测，所有失败均断言 fetch 调用数0、原bucket不清空                         |
| 同任务连点/双组件/两pair并发prepare/旧响应/compare-remove                                        | 纯状态协调测试；确保一次start且不覆盖另项，不依靠React下一次render               |
| 精确row全字段匹配、多项/不匹配/空GET/invalidJSON/未知错误                                        | 纯HTTP adapter测试，true不被错误清除                                             |
| prepare成功→true写入后、fetch调用前刷新；POST服务端成功但客户端断流后刷新；GET暂空后再出现row    | 生产浏览器+真实HTTP故障入口；先unknown/只GET，再真实row接管，不重新prepare/start |
| start首请求与同key重放、平台更新或当前平台不可用时已有key仍返回、陈旧CAS只阻止不存在key首次claim | 真实PG/服务集成测试；浏览器不能替代此事务证据                                    |
| storage不可用/满额、禁用/归档/read-only/登录过期恢复、返回前一页及同tabreload                    | 生产浏览器；pending保留、按钮状态正确、无自动网络写                              |

V/D/S服务负责 prepare/start/replay、错误结果分类和 exact row DTO；U HTTP/UI负责请求转换、strict browser schemas、单一 pending store/同步gate/页面展示。不能各自复制 validation key hash算法或 SQL。
当前 receipt CreateReceive 仅useState内存，刷新警示是其已知边界；此评审不扩大去改旧上传流程。B2-2B需新增pending模块，复用已有strict response模式而非直接继承其未知清除策略。

## 补充：最小严格 StartResult（回应既有 errorResponse 歧义）

域服务和该 start route 采用主合同闭集联合；不改通用 errorResponse，也不新增表：

```ts
type StartResult =
  | { outcome: "record"; created: boolean; validation: ValidationDto }
  | {
      outcome: "not-started";
      execution: "not-started";
      productId: string;
      importId: string;
      expectedValidationKey: string;
      expectedImportStateRevision: number;
      code: PreclaimStartCode;
    };
```

- record/created=true 对应201；record/created=false 对应200。客户端校验状态与 discriminant 一致，再校验完整 immutable tuple；否则按未知保留。
- not-started 使用200作为已确定的领域拒绝结果，以 strict 独立schema解析，不能落进现有 `errorResponse` 通用码分类。其文字明确“本次尚未开始”，不是内容验证成功。
- `PreclaimStartCode` 采用主合同的精确闭集，且仅限已被实现证实的前置分支；该code只解释原因，**清除权威来自显式服务结果的阶段证明**，不来自名称。未审实分支不得先加入名单。
- 服务只在控制流明确尚未进入任何可能 claim/COMMIT 路径、所发出的相关工作已settled时返回 not-started。不是 `catch(err) => notStarted(err.code)`；尤其同名 IDENTITY_CHANGED/AUTH/CAS/timeout 若发生在 claim 后不能映射。
- 进入可能写 claim 的调用边界前就永久关闭本次 not-started 返回资格；SQL提交/连接失效/取消未知一律通用失败保留pending。首批可保守地不把事务内“可能已回滚”情况转成 not-started；若以后要支持，必须由 repository 返回确定 rollback/无迟到写的专门结果，不能从异常码猜。
- 已确认 row 的错误处理可返回 record；不能把“后续工作失败”称为 not-started。prepared binding 查询的控制CLI未知也不能假称全部工作settled；保留有限维护错误。
- 所有通用非2xx `{code,requestId,currentRevision?}`、不完整/未知/非法JSON、错误status组合默认保留true，不管code熟不熟悉。仅上述完整not-started结果可成为显式放弃依据。
- not-started 绑定 request route pair、expectedValidationKey和原CAS revision；客户端只处理当前从 false 成功 mark-before-start 发出的单次请求的响应。它证明“这一调用未claim”，不是“所有历史/并发调用均未claim”；任何更早unknown项不能被它清除。
- 若接收not-started后删除bucket失败，保持原true并提示本地记录仍待核实；不能在内存显示已清除后允许新start。不为了可用性回滚 mayHaveBeenSent 或生成新key。

此方案刻意保守：通用401/403等若无法提供受审前置结果，也会留下unknown锚点。首批优先保留核实能力，不用通用码解除发送门；可在共享合同审查时为确证前置分支补显式结果，而非增加错误码猜测。
