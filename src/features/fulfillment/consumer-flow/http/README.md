# P4 HTTP 安全入口

当前只实现来源/Cookie、有界 JSON 读取和有限私有错误响应，不是可用业务路由；不导入尚未落地的 factory，也不构造假成功服务。

security.ts 对消费者 API 核精确 loopback profile、Host、URL origin、POST Origin 和必需 same-origin Fetch Metadata；exchange 额外核固定头。grant Cookie 按精确名称读取，重复/歧义/坏 codec 拒绝，不借用 Studio/access-key token；仅生成 session 路径的 HttpOnly、SameSite=Strict、本地 HTTP Cookie，不设 Domain 或假 __Host 保证。

readConsumerJson 用固定 buffer 核实际 UTF8 字节、单一原始 DatabaseBudget 与最多5秒读取窗口，拒绝编码/非JSON/坏UTF8/深度超32/非有限值，不信 Content-Length。停滞/零字节流按期限退出，取消异常不替换有限错误。consumerFailureResponse 只输出冻结 consumer-error.v1，不序列化异常/路径/SQL/凭证，所有响应 private/no-store、no-referrer、nosniff，无CORS。

后续 handler 必须先按操作严格 Schema 解析/核完整原binding，再调用 A 的 request owner/三组 service factory。HTTP不能另开DB或重起15秒；finally调用closeIfNotTransferred，图片字节必须通过同owner的resourceBody精确一次交接。这里尚未实现这些业务与生命周期接入。

2026-10-18：7项合成边界测试实际通过，覆盖缺/错源头、重复Cookie、独立codec、有限错误、误导Content-Length、实际+1、多字节、坏编码/流故障、深度/数值、停滞与无限零字节流。不接DB/native/3100，不是实际消费者授权事务或全P4出口。

2026-10-18 HTTP P2 整改：读取循环只在外层与中断 Promise 竞速一次，保留原期限、每32读让出、检查点和取消；不再随空分块累计中断 reactions。原独审反例在本树修前为134/8450/33794，修后为1/1/1（128/8192/32768空分块，实际正文均2字节）。响应运行时仅显式读取并验证Set-Cookie，宽对象不能覆盖固定私有头或注入CORS。原7项加2项反应计数/运行时头边界回归；原反例与本树修前/修后JSON保留在忽略的.cache/p4-review（probe内commit字段为原审查来源，不是修后提交身份）。浏览器request新实现同步采用单一外层竞速，仍待自身测试及host接入。

handler.ts现提供handleConsumerHttp(request, endpoint, dependencies, startedAt)，依赖只注入真实createOwner(config, clock)/createService(owner)，本文件不创建DB或伪造业务。clock在入口开始且一路同一15秒；source、method、query重复/未知、Cookie、CSRF及严格body/full session binding先核，非法请求零owner。save双hash与响应session/entry/report/resolution再核。写服务返回后的封套验证/真实close失败转OUTCOME_UNKNOWN；读错误不变成写权限。exchange只输出result，grant仅Set-Cookie；logout严格空对象，204并清同session路径Cookie。

资源只把service返回的同一Uint8Array原对象交给同owner.resourceBody一次，HTTP不预读、不克隆、不另包stream或dispose已移交timer；finally始终同owner.closeIfNotTransferred，JSON还在返回前await实际close。owner未建时才由HTTP dispose clock；真实owner须负责其最终close/quarantine及clock清理。7项适配单测通过：非法入口零owner、同clock/owner关闭、exchange隔离、写成功后封套/close UNKNOWN、exact资源身份与移交、重复selector/错误hash零服务、严格save及有限失权。测试owner/service为明确合成fixture，不是实际DB/事务/关闭证明。

尚未导入未交付的A factory或挂app路由；待A request-owner/service及root实际resolver提交后再做真实接线，不能将此依赖注入层当可用消费者HTTP服务或P4验收。
