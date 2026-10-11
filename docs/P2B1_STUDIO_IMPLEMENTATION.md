# P2-B1 HTTP/UI 实施记录

日期：2026-10-12（Asia/Shanghai）。B 流基线为 `a2df7b8c1f6d1fd0322560bc9c917e89fc7f469a`，受管 worktree 为 `p2b1-catalog-studio/quiz-forge`，分支 `codex/p2b1-catalog-studio`。本流工程交付不代替 B1 集成、独立审查、浏览器图检和作者验收。

## 范围与依赖

本流拥有新增 Product/category/tag HTTP handlers、Studio 工作区 UI、客户端错误适配、HTTP 测试、workspace E2E fixture/spec 及本页。冻结行为依据 [STUDIO_P2B1.md](STUDIO_P2B1.md)。所有业务写调用 A 服务，没有直接领域 SQL、旧 actor 写授权或浏览器 role 授权。

总控指定接入的 A 提交：公共合同 `7fd4fa3d35ed5583e3d4185d9879454e653f14c4`（本地 `5a8bf2a`）；真实 CRUD `081d16d7b5f4ac3feb856337c010a4dfce7d3d0c`（本地 `01e1568`）；短只读事务保护 `51206977dd4fe164c9ed4051d67fb18747fca28b`（本地 `47bbd97`）。最后一项仅 A 文档发生上下文冲突，采用指定来源提交的原文解决，未更改其领域实现或合同。

本流未改 package/lock/CI/共享测试配置，未建 PR、合并 main、部署或运行生产迁移。没有 draft/import/assets/评分/发布/Key 按钮。HTTP3100、生产 E2E、截图验收由总控独占串行执行。

## 页面与交互

- `/studio`：真实身份、到期和退出保持可用，增加工作区和目录导航。
- `/studio/products`：有限分页、标题/ID/slug搜索、单分类/标签 AND 筛选、未分类和归档状态、创建。空库、筛选无结果、读取加载、失败和只读分开显示。
- `/studio/products/[productId]`：稳定 ID 只读、slug/标题/目录关联完整替换、元数据修订、归档说明及明确恢复路径。旧归档关联可以保留或移除，新增选择器仅允许有效目录；最多8标签、同名目录显示slug。
- `/studio/taxonomy`：分类/标签分页搜索、创建、重命名、归档/恢复及关联工作区数量。slug创建后不改，归档不释放。
- 冲突保留未保存输入并锁住提交；显式读取最新内容后，可以采用服务器内容，或保留输入并以最新修订明确重提。读取本身不覆盖输入。
- 写请求断线、响应解析失败或后端结果未知，不自动重发、不显示保存失败。Product创建按此次提交的固定ID核实；taxonomy按精确slug加status=all核实，不能用模糊第一页无结果推断未创建。
- 核实说明“服务器当前值已确认”，不以当前值断言原请求确定成功。当前查询未找到时仍由运营者明确决定下一次提交。
- 只读不渲染可执行写控件；角色仅控制展示，服务逐次验证实际会话权限。局部样式为16px正文、48px控件、换行与键盘focus；移动视觉结论待总控真实浏览器验收。

## HTTP 接口

12个Route Handler文件提供16个业务方法。薄路由调用本流 `handleWorkspaceHttp(request, endpoint, service)`，实际service为A的实现，满足其 `WorkspaceService` 固定签名。

| 路径                                                  | 方法与行为                   |
| ----------------------------------------------------- | ---------------------------- |
| `/api/studio/products`                                | GET列表；POST创建            |
| `/api/studio/products/[productId]`                    | GET详情；PATCH完整替换元数据 |
| `/api/studio/products/[productId]/archive`、`restore` | POST可恢复生命周期变更       |
| `/api/studio/categories`、`tags`                      | GET列表；POST创建            |
| `/api/studio/categories/[id]`、`tags/[id]`            | PATCH重命名                  |
| 对应目录 `[id]/archive`、`restore`                    | POST可恢复生命周期变更       |

HTTP边界复用P2-A配置、Host/Origin/Fetch Metadata、Cookie/CSRF、实际4KiB/5秒流读取和安全错误响应；body/query/path使用A的strict schema及query decoder，未知/重复query、写入或详情上的query、错误ID/UUID与revision类型均拒绝。响应no-store、无CORS、不引入业务Cookie。领域事务、审计与read/write权威仍由A服务负责。

`StudioClientError.currentRevision`只接收两种CAS冲突的合法整数 `1..2147483647`。`studioFetch`的可选第三参数对不确定业务写保守处理，既有登录/退出调用保留默认语义。UI不渲染原始异常或响应正文。

## 实际验证

最终format:check、lint、typecheck、test、build通过；普通单测33文件473项（含本流12项客户端边界测试）。最终真实test:db为7文件132项（A领域/认证111项加本流HTTP21项）。新增只读taxonomy各写方法断言后的HTTP21项定向复测通过。

初次类型复核因标签限额检查直接比较不同Zod泛型实例失败，已改为Product分支的独立限额检查；修正后类型、构建和真实HTTP均通过。构建最终有一项Turbopack警告：现有runtime私有目录路径模式过宽。目标构建的46份nft追踪中累计27164条去重路径字符串包含.cache/p2a（相对深度造成同一文件多种路径），其中12条JSON引用。仅检查本机app密码在生成的客户端/服务端JS中均无匹配；不能据此把追踪包声明为安全发布产物。共享runtime/Next配置的追踪排除交由总控整改，本流未越权改动。

workspace私有E2E helper的真实prepare/cleanup已通过。凭证仅写入独占0600文件，读取验证所有者/类型/限长/运行ID，登录避开locator.fill(secret)，trace/video/自动失败截图全部关闭。helper复用A的七表受限reset，不操作demo库。

8项workspace E2E已准备但本流未执行：空库只读/四移动宽度；目录与工作区创建及8/9标签；CAS保留输入；响应丢失读取/归档恢复；归档旧关联与taxonomy精确slug核实；有数据只读；列表加载/读取失败/显式重试；Product未知创建按ID核实且不重发。总控负责项目依赖studio-auth、独占3100和实际图检，不能用spec存在代替浏览器通过。

本流专属purpose=test实例 `c32472a88264b3ca6da3de069ea58c00` 使用55422，origin3112仅为请求边界配置，未运行HTTP服务器。新建/迁移重放与恢复后的0004升级均成功；最终已受管stop/status确认stopped，55422释放；私有manifest/配置保留可恢复。

## 限制与交接

原生Postgres驱动的系统性断连问题仍由总控专项处理，本流的常规检查和所接入的临时保护不等于该点已经验收。独立review另发现旧SQL check对U2065过度拒绝、孤立UTF16 surrogate在UTF8写入时被替换两项text边界，A正在补0005迁移与DTO拒绝；本交付尚未包含该修正，后续由总控集成。生产E2E、移动截图助手实际图检、独立Astra审查、最终B1阶段验收及远端CI均无本流通过声明。

总控只需集成本流最后的HTTP/UI提交；A依赖已按指定来源在本分支接入。当前业务接口未扩展冻结合同，后续仍不自动实现B2或其他阶段能力。
