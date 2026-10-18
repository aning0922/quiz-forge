# P4 消费者合同准备

此目录目前仅为待独立审查的 v1 共享机器合同基础，未建立消费者表、凭证服务或答题路由，不表示 P4/P5 已完成。严格业务 Schema、完整 hash 关系、字节上限和有限服务接口收口后才供两开发线接入。

浏览器与服务器共享纯数据定义；禁止导入 Node crypto、数据库、原始 QuizPack 内容或评分权重到浏览器。规范 JSON 只用于已经有界解析并通过具体严格 Schema 的 DTO，不声称浏览器可以识别任意 JavaScript Proxy。保留独立的协议 canonicalizer，是为了不改写已封存 P3-E renderer/engine 闭包字节；它不替换服务器通用不可信对象解析器。

凭证摘要、CSRF 和新的实体事实使用独立域或明确 schemaVersion。selector ID、hash 或 cursor 均不授权读取/写入；实际授权由服务端凭证服务及同事务约束决定。预算仅适用本机 test/demo/ci 内测，未扩展生产 HTTPS、发布或渠道能力。
