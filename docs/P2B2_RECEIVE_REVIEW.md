# B2-1 原包接收独立审查

日期：2026-10-12。审查使用独立 GPT-6 Astra/high 聊天；总控负责合同决定与集成，两条 GPT-6.1 Sol/high 聊天负责实施。本文只记录已发生的审查，不把合同通过当作代码验收。

最终代码 `f070428b72570977db835946227b2c49d0666e42` 的独立增量复验已关闭全部登记问题，无剩余可复现 P1/P2。下文保留发现与整改过程，早期“待修”描述只对应当时提交；工程与浏览器结果另见验收记录。

## 实施前合同审查

最终复核提交：`5f2f8e5da3e9a6cc32dc65949a213973fa9e0938`。结论：合同层面无剩余P1/P2，以下两项P2已修订闭合。

| 发现                                                       | 修订与需落实的故障证据                                                                                                                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 只有AbortSignal不能证明60秒绝对期限，timer可能延迟派发     | Handler起点建立ReceiveContext的单调deadline，跨层不重置；实际remaining检查覆盖扫描/IO/成功事务；已确认提交不因返回前超时改失败，未知仍unknown                                 |
| CLI数据库锁失效后，已经发出的runtime替换可晚到覆盖后续启停 | runtime写前建立O_EXCL私有guard，再取storage锁，guard保留至全部IO settle；旧guard回收另用固定恢复guard，覆盖删除与重新申请；普通CLI创建后写前复查；残留恢复guard不自动递归回收 |

审查还确认：exact idempotencyKey查询与原input重提、ReceiveSource直接取消reader、有界扫描/held计量、恢复row fence与旧attempt receipt分开匹配、runtime v1/v2兼容和storage→短auth事务方向可实施。每chunk必须在写前验证累计字节不超过expected，不能只在EOF检查。

以上均为合同层审查。没有执行接收代码、数据库迁移或故障测试；实际证据将在实现集成后追加，门槛见[P2B2_RECEIVE_ACCEPTANCE](P2B2_RECEIVE_ACCEPTANCE.md)。

## 实现审查

公共里程碑 `b17b3911fc219aaabcaba974814d7f48e85d6648` 已获独立窄范围审查，无P1/P2。独立22项相关单测及6项原生流/File/延迟timer内存探针通过；总控另在旧v1真实实例上执行57项数据库/认证兼容测试通过。该head的CI38170812606普通和数据库job均success。此时尚无接收service/CLI/业务表，不把缺失阶段当已验收。

B HTTP/UI增量原提交3405076、集成1729a8e后，总控29项imports定向测试通过。总控登记一项P2待B修复：客户端仅JSON语法解码后类型断言，HTTP成功但DTO无效/错归属时可能误清unknown或渲染失败。要求增加窄的响应验证、保留原key/input/id、未知错误码保守unknown、exact key结果0/1及原声明校验。另需同步显式恢复后的父组件状态，使恢复至awaiting时可就地选原文件。修复与浏览器证据尚未交付。

接收服务、迁移、管理guard与实际故障验收仍在实施，未宣称B2-1技术验收通过。

独立Astra在1729a8e另发现P2：首次创建unknown→exact-key查询0→原key重提收到CSRF_REJECTED时，catch覆盖unknown=false，错误允许丢弃首次key/input。已派B保留累计unknown，只有匹配原请求的有效结果才能清除；要求完整序列回归。独立29项现有测试通过，内存hook/响应桩可复现；不是浏览器验收，修复尚待复核。

核心集成90be27d已通过591项unit、174项真实DB及格式/lint/类型，root旧v1实例追加0006/0007成功。独立Astra审核心登记4项P2并派A修：扫描最终IO跨5秒仍成功（已内存复现）；只核存量导致可创建第1025目录/超过条目峰值；storage健康/解锁响应黑洞无客户端2秒截止（2150ms仍挂探针）；request DB初始化/preflight/写事务同样缺总deadline/abort（25mscontext在150ms仍挂且无关闭探针）。最后一项冻结独占request DB生命周期补充，文件IO仍必须settle，不能裸race整个服务。没有真实网络黑洞故障验收，待修复后取得。

B73d35e2→aa8099e的独立复审关闭累计unknown与恢复父子同步；响应校验仍留一项P2：错误码与HTTP status失配被当确定拒绝。502/CSRF_REJECTED与500/INVALID_REQUEST必须归unknown，合法403/CSRF仍可确定拒绝。已派B修，49项现有定向测试通过不代替该回归。

修复cd7688d→aa22f63复核时，原四个失败探针已闭合、6文件18定向unit通过，但发现2项仍需A修的P2：namespace准入没有计算旧held尝试尚未落地的目录/文件峰值，失锁后的晚到mkdir可越过1024上限；成功stopped receipt已发布后catch仍重复创建receipt临时文件，另一recover可能已释放预留。要求全held容量headroom与receipt读核幂等/发布后不再写。两项已派回；不得因原探针通过宣称整体闭合。

同轮复审第三项P2：StorageLock.query(promise)在观察已求值的heldRows promise前assert，失效时遗落拒绝；实际heldRows/失效连接内存探针观察到unhandledRejection。已要求工厂式query，先assert再启动，完整修复前不关闭核心审查。

## 收口复验过程

`aec72c1` → root `2d17550`：独立 Astra 的 3 文件 14 单元及内存探针确认旧 held 未落盘 namespace 计量、停止证明只读重放及发布后无新写闭合。无新增文件的过额恢复静态复核通过，仍保留完整扫描、账目、当前权限、停止证明与 fence；真实故障证据由总控 212 项 DB 回归补足。

factory 修复还有一个求值顺序窗口：`work()` 产生 Promise 后，`remainingReceiveMs()` 恰好抛错，拒绝未进入观察链。独立探针实际观察到 `unhandledRejection`，已要求预算先算、工厂结果立即进入被观察 Promise 链，同时修正 acquire 参数顺序。此项尚未关闭。

B 最终窄审基线 `abc4c87`：HTTP 将同一 ReceiveContext 传给 DB factory 与服务；原生 input 保持、显式重选、累计 unknown、恢复提示及简化列表均未引入新的 P1/P2。5 文件 55 项独立纯单测通过；没有冒充浏览器或 A 内部实现验收。

## 最终独立结论

最终 A 增量 `8a3eda5` → root `f070428`：原探针在 factory 内触发 abort 或越过 deadline 后都返回 `RECEIVE_LOCK_LOST`、永久失效，且没有 unhandled rejection；reserve、SET、try-lock、query、unlock 的工作结果均进入被观察 Promise 链。3 文件 17 项独立单元全部通过。`source.cancel()` 保留接收者的修正、0007→0008 真实启用门槛、revision/fence 上限及身份禁用测试未见新增问题。

B 增量的独立结论沿用上一节 55 项单测及具体范围；此后没有修改后台行为。构建路径标注未削弱运行时路径检查。A/B 的已登记问题全部闭合，本轮限定实现中无剩余可行动 P1/P2。独立审查没有执行 root 真实 DB、build 或生产浏览器，不能代替总控对应检查；自动断言和截图也不是作者视觉、内容或商业批准。
