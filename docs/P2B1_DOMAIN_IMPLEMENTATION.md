# P2-B1 A流：数据库与领域交付

日期：2026-10-12。独立 worktree `p2b1-catalog-domain/quiz-forge`，分支 `codex/p2b1-catalog-domain`，基线 `a2df7b8c1f6d1fd0322560bc9c917e89fc7f469a`。范围按冻结 STUDIO_P2B1；原检出未修改，HTTP/UI/E2E和共享配置由B/总控负责。

## 公共里程碑

已实现 `src/features/product/workspace/contracts.ts`：严格Zod输入、NFC/trim显示文本、Unicode code point长度、UUID/ID/revision、8标签集合、DTO/分页查询与严格URLSearchParams解码。浏览器可安全导入；类型不含数据库配置或认证原文。`parseWorkspaceQuery(params,"product"|"taxonomy")`解析错误抛出，HTTP统一映射INVALID_REQUEST。

`service-contract.ts` 固定后续 `service.ts` 的11个具名服务签名：参数依次为database、sessionToken（读取）或credentials（写入）、kind/id（适用时）、input/query。写服务只接 `StudioWriteCredentials`，不接旧actor；读取逐请求验证会话。此文件仅声明类型，本里程碑尚无CRUD实现，不供Handler伪造成功。

`src/lib/auth/write.ts` 实际实现 `withStudioWrite(database,credentials,capability,work)`：当前token/CSRF、同auth锁、当前role/会话、提交前再校验和条件touch。回调只做有限SQL；事务本地超时2s/5s/10s。复用提取至auth/internal.ts的既有actor逻辑（时间string/Date兼容），未改变原认证政策。postgres3.4.9在成功ROLLBACK后传播回调错误，已确认取消/锁超时映射WRITE_BUSY；提交/连接不确定映射WRITE_OUTCOME_UNKNOWN，不重试。业务冲突错误仅允许受控正整数currentRevision。

Schema新增四表与审计目标列。0002独立添加12个enum值，0003才使用新值建立实体/关联与审计约束；未改0001。migrate.ts集中重授新列/表权限，保留旧表权限。共享fixture显式清空七表，无CASCADE，提供 `authenticateTestOperator` 与防原始SQL错误泄漏的 `safeTestOperation` 给B复用。既有P2-A表清单断言随四表扩展更新。

验证：冻结安装成功；普通测试30文件452项通过；真实PG18.4测试3文件61项通过（旧57+共享写4）；typecheck、lint、format:check通过。真实数据库为本worktree新建purpose=test实例，端口55421；升级应用0002/0003成功。配置/凭据只在忽略私有目录，未启动HTTP3100。

## 继续实施与限制

领域CRUD/CAS/分页/并发与四表权限回归仍待后续提交。本里程碑不宣称B1完成；build、HTTP/UI/E2E、助手截图与独立审查由集成阶段验证，不宣称远端CI。没有PR、main合并、生产迁移或部署。

## 领域实现与追加修正（第二提交）

`service.ts` 已实际导出冻结签名的全部11个服务；`repository.ts`只供领域内部有限SQL使用，B不可直接访问repository或执行领域SQL。所有写服务内部调用withStudioWrite，读取在短只读REPEATABLE READ中重验会话和studio:read；count/items/目录摘要处于同一快照。写事务显式READ COMMITTED，避免继承RR快照导致auth锁后看到旧角色。服务运行时再次严格校验input/path/query，且不接旧actor。

Product创建先插入无关联根，再按固定UUID序锁目录；替换先锁Product、CAS、锁旧新引用并集，再比较规范化字段/标签集合。标签内部slot按UUID排序。已有归档关联允许保留或移除，仅新增引用检查active；分类/标签归档不反向锁Product。生命周期可恢复且保留关联/唯一身份；真实变化同事务记录有限审计，no-op不改变revision/time/audit；revision上限只允许no-op。

列表固定created_at DESC,id ASC，分页上限与未知UUID空结果已实现；q为参数化字面子串，转义LIKE的百分号/下划线/反斜线；taxonomy另支持精确slug，供未知创建结果核实。Product DTO不带slot或原始DB/认证记录。

公共早审提出两项边界：

1. 0003已被其他线应用，保留checksum，追加0004。原C locale空白类及局部Cf列表不完整；JS/SQL现在固定同一份Unicode17.0的Cc/Cf/Zl/Zp和尖括号范围，以及ECMAScript trim空白集合。范围通过遍历U+0000..U+10FFFF生成，不按locale推导或手抄部分字符；JS运行时使用冻结正则。PostgreSQL text本身不允许U+0000，SQL范围从U+0001起。新增全角/不间断空白、U0600/UFFF9/非BMP格式字符、中文/emoji边界与完整JS策略回归。0004初次因SQL不允许U+0000字面量而失败并回滚；修正未应用版本后成功应用，没有重写0001/0002/0003。
2. 已确认回滚的普通SQL/内部回调异常改为STUDIO_UNAVAILABLE。包装器记录回调失败对象，仅在驱动成功ROLLBACK后原样传播时分类业务错误/WRITE_BUSY；回滚回执丢失、提交错误或致命连接/事务终止为WRITE_OUTCOME_UNKNOWN，不自动重放。实际提交后回执丢失的故障注入测试可按稳定ID读到revision1与唯一审计。

原生postgres3.4.9在服务器transaction_timeout终止会话后可能尝试向空socket排队回滚，触发connection.js:255的未捕获TypeError。忽略目录`.cache/p2b1-driver-repro.ts`保留脱敏原生驱动复现：begin内statement_timeout=0/transaction_timeout=10s/pg_sleep(11)，没有主动client.end并发触发，固定诊断且exit1。实际包装器在致命连接/事务终止时先终止请求专属sql客户端，避免驱动继续向死socket排队；调用方finally仍须关闭（幂等），不能跨请求共享该P2aDatabase。真实自身backend终止及事务期限定向测试已无未捕获异常通过，未修改依赖/package/lock。独立审查仍需复核此处理。

本地检查：format:check、lint、typecheck、普通32文件461项通过；新增领域/权限/竞争与既有认证/管理测试使用真实PG18.4。精确最终DB与build结果在收口记录补齐。没有HTTP/UI/E2E验收声明，没有远端CI声明。
