# P2-B1 验收记录

2026-10-12（Asia/Shanghai）。状态：实施中，尚未技术验收。总控分支codex/catalog-workspace，基于P2-A最终38177fb；后者CI38163814070的两个job均已实际success。范围及固定接口见[实施合同](STUDIO_P2B1.md)。

## 当前证据

公共实现7fd4fa3集成为6af3ab0，已包含Product/category/tag/product_tag四表、两次追加迁移、有限审计目标、严格DTO/查询、共享写事务鉴权和显式七表test reset。service-contract.ts只声明后续CRUD签名，不能冒充可运行的服务。

总控初次公共里程碑检查：format/lint/typecheck、30文件452单测、生产构建均通过；新隔离PG18.4实例上3文件61项真实DB通过。没有完成本阶段业务API、UI、E2E或独立最终审查；这些数字不代表B1完成。

总控实例为purpose=test，标识b014361dd7f84f82cd6591a335f9ce83，专属55423；配置在本工作树私有忽略目录。其他开发线使用自己新建的55421/55422实例，不共享配置。3100只由总控使用。

## 尚在处理的具体问题

- 数据库文本兜底与DTO存在Unicode差异：根事务探针确认纯U+3000、X+U+0600、X+U+FFF9在Schema拒绝、DB接受。普通文本正常；U+0080已由DB拒绝，不计为绕过。探针全部回滚，A以追加迁移修复，不更改0003已应用checksum。
- 已确认回滚的普通内部SQL错误被错误分类为WRITE_OUTCOME_UNKNOWN；A正在按事务阶段与回滚事实修复，无法确认的连接/提交仍须保守处理。
- 写事务显式READ COMMITTED已派落实；列表一致性快照单独处理，不能让等待auth锁前的旧快照绕过当前角色与撤销检查。

以上是根与Astra独立检查的当前发现，尚未闭合，不声明业务安全验收通过。

## 最终必须核验

四表的权限、8-slot硬上限、稳定ID/slug和Unicode文本规则；从P2-A升级/重放/checksum/失败回滚；成功审计与实际revision绑定，no-op无虚假审计。旧认证能力必须保持。

真实两个连接的CAS、归档/分配顺序、旧归档引用保留与移除、归档恢复、revision上限；auth锁等待后及提交前的过期/撤销/停用/当前角色重验；确定回滚、提交未知和网络响应丢失分开呈现。

真实HTTP覆盖来源/CSRF/只读、strict body/query/path、分页和字面搜索、精确slug恢复核实。生产UI覆盖空状态、创建、编辑、筛选、归档恢复、冲突保留输入、未知提交和只读；四移动宽度截图由助手实际检查。

最终运行format:check、lint、typecheck、test、build、test:db、test:e2e。workspace E2E依赖studio-auth，两个fixture不并发清库；所有后台项目关闭trace/HAR/video/自动失败截图。工程检查不代替作者视觉、内容或素材批准。

交付将记录精确SHA、Draft PR、独立审查、代码及最终文档head的真实CI状态，随后停止测试进程并按已授权路线继续B2。当前无B1 PR，没有main合并、生产迁移、部署或发布。
