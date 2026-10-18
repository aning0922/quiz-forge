# P4 HTTP 安全入口

当前只实现来源/Cookie、有界 JSON 读取和有限私有错误响应，不是可用业务路由；不导入尚未落地的 factory，也不构造假成功服务。

security.ts 对消费者 API 核精确 loopback profile、Host、URL origin、POST Origin 和必需 same-origin Fetch Metadata；exchange 额外核固定头。grant Cookie 按精确名称读取，重复/歧义/坏 codec 拒绝，不借用 Studio/access-key token；仅生成 session 路径的 HttpOnly、SameSite=Strict、本地 HTTP Cookie，不设 Domain 或假 __Host 保证。

readConsumerJson 用固定 buffer 核实际 UTF8 字节、单一原始 DatabaseBudget 与最多5秒读取窗口，拒绝编码/非JSON/坏UTF8/深度超32/非有限值，不信 Content-Length。停滞/零字节流按期限退出，取消异常不替换有限错误。consumerFailureResponse 只输出冻结 consumer-error.v1，不序列化异常/路径/SQL/凭证，所有响应 private/no-store、no-referrer、nosniff，无CORS。

后续 handler 必须先按操作严格 Schema 解析/核完整原binding，再调用 A 的 request owner/三组 service factory。HTTP不能另开DB或重起15秒；finally调用closeIfNotTransferred，图片字节必须通过同owner的resourceBody精确一次交接。这里尚未实现这些业务与生命周期接入。

2026-10-18：7项合成边界测试实际通过，覆盖缺/错源头、重复Cookie、独立codec、有限错误、误导Content-Length、实际+1、多字节、坏编码/流故障、深度/数值、停滞与无限零字节流。不接DB/native/3100，不是实际消费者授权事务或全P4出口。
