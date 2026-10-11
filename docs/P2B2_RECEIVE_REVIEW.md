# B2-1 原包接收独立审查

日期：2026-10-12。审查使用独立 GPT-6 Astra/high 聊天；总控负责合同决定与集成，两条 GPT-6.1 Sol/high 聊天负责实施。本文只记录已发生的审查，不把合同通过当作代码验收。

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
