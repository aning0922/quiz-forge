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
