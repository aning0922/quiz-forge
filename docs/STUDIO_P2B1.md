# P2-B1：目录工作区实施合同草案

日期：2026-10-12。状态：**待总控最终冻结，未实施**。本文件只收敛 B1，不能据此自行启动代码开发；P2-A 实际技术门槛由总控收口后再安排实施。本文没有新增表、业务服务、测试通过或 UI 验收的声明。

分析基线：`codex/studio-foundation`，`720b982ae486dbe7349dfa7034367cf8a6c76875`。依据 [P2-B 预案](STUDIO_P2B_PREFLIGHT.md)、[P2-A 合同](STUDIO_P2A.md)以及现有 [auth service](../src/lib/auth/service.ts)、[auth lock](../src/lib/db/auth-lock.ts)、[DB client](../src/lib/db/client.ts)、[schema](../src/lib/db/schema.ts)、[migration runner](../src/lib/db/migrate.ts)。

## 范围与退出条件

B1 交付真实 Product 工作区、单主类目、有限运营标签、列表筛选、元数据编辑及可恢复归档。只增加 `product/category/tag/product_tag` 四张业务表，并有限扩展既有审计。两角色继续为全局 operator/read-only，未实现逐 Product 人员 ACL。

本阶段没有 draft/import/asset 表，没有发布指针、题库、评分、预览、送审、Key 或消费者目录。UI 不创建这些能力的按钮。Product 是 B2 后续草稿和资源的稳定归属根，不另建 Project 实体。

交付须有真实 PostgreSQL CAS/no-op、归档与分配并发、会话撤销/角色变化与业务写入竞争、SQL 权限、HTTP 安全、浏览器 UI 及移动截图证据；仅建表或页面能打开不算完成。

## 运营域字段与身份

- Product ID 直接复用 [P1 packIdSchema](../src/features/quizpack/v1/manifest.ts)：`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`，最多 80 字符。创建后不可变，不自动转小写、修剪或重写。
- Product slug 使用同一语法/80 字符上限，独立唯一，可按元数据 CAS 修改。归档也不释放 ID/slug。
- category/tag 为服务器生成 UUID；slug 使用上述语法/80 字符上限，创建后不可改。本阶段“重命名”只修改显示 name，保持目录身份稳定。
- Product title 为 1–120 Unicode code points；category/tag name 为 1–40 code points。服务端以 NFC + trim 得到规范显示文本后校验，不允许控制字符、换行、`<` 或 `>`，不接受全空白。仅作纯文本渲染，不解析 HTML/Markdown。
- SQL 使用 varchar/char_length 限制；TypeScript 按 code points 计数，不用 UTF-16 `.length` 代替此长度规则。数据库另外 CHECK 非空白、无控制字符/尖括号，防止普通直接 SQL 写入空名称。
- 这些是简短运营目录字段，不是 P1 的最大 4000 字符内容字段。包内 product.title/slug/categoryId/tags 是版本声明，不能自动覆盖这里的字段；后台最多 8 个运营标签不改变 P1 包内 tags 最大 12 的合同。
- 所有 revision 使用 PostgreSQL integer，范围 `1..2147483647`；达到上限拒绝实际变更，不溢出。不把 metadata_revision 当 draft revision 或内容 hash。
- 分类/标签 name 允许重复，slug 不重复；管理选择器显示 name 与 slug，避免同名误选。运营标签是集合，没有用户排序语义。

## 四表精确存储合同

沿用专用 `qf` schema，所有时间为 timestamptz，UUID 由 Node 生成。身份/外键默认 ON UPDATE RESTRICT、ON DELETE RESTRICT；没有业务硬删除入口。

| 表            | 列与约束                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product`     | `id varchar(80) PK`；`slug varchar(80) UNIQUE NOT NULL`；`title varchar(120) NOT NULL`；`primary_category_id uuid NULL FK category(id)`；`metadata_revision integer NOT NULL DEFAULT 1`；`created_at timestamptz NOT NULL DEFAULT clock_timestamp()`；`updated_at timestamptz NOT NULL`；`archived_at timestamptz NULL`。id/slug 正则与长度同 P1；title 约束如上；revision 正值；updated_at≥created_at，archived_at 为 null 或不早于 created_at。 |
| `category`    | `id uuid PK`；`slug varchar(80) UNIQUE NOT NULL`；`name varchar(40) NOT NULL`；`revision integer NOT NULL DEFAULT 1`；`created_at/updated_at NOT NULL`；`archived_at NULL`。时间、slug、name、revision 同上规则。                                                                                                                                                                                                                                 |
| `tag`         | 与 category 相同。                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `product_tag` | `product_id varchar(80) NOT NULL FK product(id)`；`tag_id uuid NOT NULL FK tag(id)`；`slot smallint NOT NULL CHECK 1≤slot≤8`；PK `(product_id,tag_id)`；UNIQUE `(product_id,slot)`。slot 仅用于数据库硬性保证每 Product 最多 8 条，无用户排序语义。                                                                                                                                                                                               |

Product 创建时 created_at/updated_at 使用同一个数据库时刻；更新和归档均用数据库时钟。关系更新在锁 Product 的事务中完成；标签按 tag UUID 固定排序分配内部 slot，客户端不能提交 slot。

索引至少包含 Product `(archived_at,created_at,id)`、`primary_category_id`；product_tag 反向 `(tag_id,product_id)`；category/tag `(archived_at,created_at,id)`。列表固定 `created_at DESC,id ASC`；不按可编辑名称排序来定位页面。slug/id 使用受限 ASCII，不受前端 locale 排序影响。

数据库凭据仍是 P2-A 私有 app role。B1 不创建新连接入口，不读取 DATABASE_URL，不更改实例/profile/集群边界。

## SQL 权限与迁移

- app 对 product/category/tag 为 SELECT、INSERT；UPDATE 只授予可变元数据、revision、updated_at、archived_at。不可 UPDATE id/created_at；category/tag 不授 slug UPDATE。
- app 对 product_tag 为 SELECT、INSERT、DELETE，不授 UPDATE。DELETE 仅为移除关联，并不允许删除 Product/类目/标签。
- 所有四表均无 app TRUNCATE；三种实体无 app DELETE。PUBLIC 无权限，app 无 DDL/owner/角色管理权限。
- 既有 operator/session/audit 的权限不能顺便扩大；audit 仍仅 SELECT、INSERT，不可 UPDATE/DELETE/TRUNCATE。
- 在现有 `migrations/p2a/` 序列追加迁移，不重写 `0001_identity.sql` 或已应用 checksum，不为 B1 重命名整个迁移目录。
- 现有 runner 每次 REVOKE 后重建 app 授权。A 流必须更新 runner 的集中授权清单并做重放测试，不能只在新 SQL 中添加随后会被撤销的 GRANT。
- audit_action 目前是 PostgreSQL enum。新增值和任何使用新值的语句需遵守迁移事务边界；不要在同一事务内立即以新 enum 常量写记录。可先迁移增加值，后续独立版本增加依赖约束；不为方便改写旧 enum 或关闭事务。

## 审计的有限扩展

新增 action 仅为 product/category/tag 各自的 `created/updated/archived/restored`，共 12 项，例如 `product_created`。不新增泛化事件 JSON。成功变更在同一业务事务插入审计；no-op 不记虚假的 updated，HTTP 拒绝也不需要另开事务无限记审计。

audit_event 追加三个 nullable 列：`target_kind varchar(8)`、`target_id varchar(80)`、`target_revision integer`。三列必须同时为空或同时有效；kind 为 product/category/tag；product ID 按受限语法，category/tag ID 为 canonical UUID 文本；revision 为正整数。新增业务 action 必须匹配对应 kind 并带有效 target；原认证 action 保持三列 null。

这是有限的审计定位，不是多态外键；实体不硬删除，服务在事务中保证目标真实存在。保留既有 actor_id/session_id/request_id，actor 来自本次事务中的权威鉴权；reason_code 对正常变更为 null，outcome=success。只记变更后 revision，不记录标题、名称、表单、Cookie、token、CSRF、SQL、路径或任意原文。

## 共享写事务鉴权：禁止复用过期 actor

现有 `readSession` 自己开事务、获得 auth lock、校验并 touch，然后返回 actor。该 actor 只能表示该次查询结果；随后调用 `requireCapability(oldActor, ...)` 不能保证业务写入时仍有权限。所有 B1 写服务必须使用同一个共享事务包装器，不各自复制认证 SQL。

建议共享接口（待冻结，由 A 流集中交付）：

```ts
type StudioWriteCredentials = Readonly<{
  sessionToken: string | null;
  csrfToken: string | null;
  requestId: string;
}>;

withStudioWrite<T>(
  database: P2aDatabase,
  credentials: StudioWriteCredentials,
  capability: StudioCapability,
  work: (tx: postgres.TransactionSql, actor: StudioActor) => Promise<T>,
): Promise<T>;
```

该类型仅在 server-only 模块中，不进入浏览器 DTO/日志。包装器接收实际 Cookie token，不接受旧 actor、operatorId 或 role 作为授权输入。

固定执行顺序：

1. HTTP 层复用 `assertStudioSource`，先检查配置、Host/Origin、实际 JSON 限额；包装器自身也验证 session token 格式及 session CSRF，防止绕过 HTTP 调用服务。
2. 包装器拥有唯一 `database.sql.begin`；首个锁复用现有 `acquireAuthWriteLock(tx)`，即同一个 `(72461,1)` advisory transaction lock。不得新增一把不相容的 auth 锁。
3. 等待 auth 锁结束后，用当前数据库时间重查 authenticated session、revoked_at、idle/absolute、operator active 及当前 role，再执行 capability 检查。read-only 返回 CAPABILITY_DENIED；无效/撤销/停用/到期返回 UNAUTHENTICATED。
4. 业务回调按下文锁定 Product 和目录行，执行有限数据库工作及审计。不在锁中读取文件、解码、请求网络、渲染页面或等待用户。
5. 回调完成、提交前再次核对会话当前有效时间/当前角色/所需能力，再进行条件 touch；若已过期或更新未命中，抛错使整个业务事务及审计回滚。touch 不延长 absolute，不在长等待之前提前续 idle。
6. 事务提交成功后才将结果返回 Handler；数据库关闭仍由调用方 finally 负责。包装器不嵌套调用现有 readSession 另开事务。

登录/退出/停用和未来角色变更也必须继续使用相同 auth lock。读页面中的 role 仅用于显示控件，不授写权。全局 auth 锁允许本地 B1 写操作串行；不在此阶段扩成复杂锁分片。

A 流集中复用/提取现有 `activeActor/toActor` 等内部逻辑，保留 Drizzle 共享 postgres.js 客户端时间可能为 string 的事实，不能在 B 流重新发明另一套 session SQL。既有 readSession/login/logout 的回归测试必须通过。

## 固定业务锁顺序与 CAS

所有路径顺序一致：**auth lock → Product 行（若操作 Product）→ category 行按 UUID 升序 → tag 行按 UUID 升序**。需要旧/新目录引用的并集时一次按该顺序锁齐，使用能与归档更新互斥的行锁，再检查 archived_at。

单独重命名/归档/恢复 taxonomy 时为 auth lock→相应 taxonomy 行，不遍历或反向锁 Product。禁止先锁 taxonomy 再锁 Product。创建 Product 时先在同一事务插入不带目录关联的新行，随后锁并校验分类/标签后完成关联；任何失败回滚，不暴露半个 Product。

元数据保存：锁 Product→比较 expectedMetadataRevision→锁旧/新目录并集→检查新引用 active→规范化字段/标签集合比较→一次更新 Product 与关系。标签重复 ID 拒绝；数组排列变化不算修改。变化时 revision+1 与 updated_at；相同内容保持 revision/updated_at、无变更审计。

必须先比较 expected revision，再判断 no-op；旧 revision 即使提交恰好相同的值也返回冲突。taxonomy 重命名用相同 expectedRevision/no-op 规则。最大 revision 上只允许 no-op，实际变更返回 REVISION_LIMIT。

分类归档与新分配竞争必须有明确提交先后：分配先完成后允许归档，已有引用保留；归档先完成后新分配拒绝。已有归档引用可原样保留或移除，不能作为新增引用加入其他 Product；不得因改标题而强迫移除已有归档分类/标签。

## 可恢复归档

Product/category/tag 均提供 archive 和 restore，不提供 DELETE。归档不删除关联、不释放 slug、不修改包声明或未来内容版本。

- 归档需要 expected revision；成功状态变化 revision+1。已处于目标状态且 expected revision 匹配时 no-op。
- Product 归档后只读，普通元数据编辑返回 PRODUCT_ARCHIVED，先恢复再编辑；归档 Product 仍能查看完整目录关联。
- category/tag 归档后不能新增分配；重命名前先恢复。恢复后允许新分配，原有关联不变。
- 恢复 Product 不连带恢复归档的 category/tag；已有归档引用带清楚标记，运营可另行处理。
- UI 提供明确的恢复操作和归档筛选。归档前简短说明影响，提交中禁止重复点击；不设置无法撤销的“删除工作区”流程。

## strict DTO 与服务入口

JSON 继续复用实际 4 KiB/5 秒读取上限。所有 body/query/path 都做运行时校验，拒绝未知字段、错误类型、重复 query key、非法 UUID/ID；不做宽松数字或 boolean 转换。expected revision 只能为合法整数，不接受字符串。

```ts
ProductCreate = {
  id: ProductId;
  slug: ProductSlug;
  title: string;
  primaryCategoryId: string | null;
  tagIds: string[]; // 0..8，唯一 UUID
};
ProductReplaceMetadata = {
  expectedMetadataRevision: number;
  slug: ProductSlug;
  title: string;
  primaryCategoryId: string | null;
  tagIds: string[];
};
ProductLifecycle = { expectedMetadataRevision: number };
TaxonomyCreate = { slug: string; name: string };
TaxonomyRename = { expectedRevision: number; name: string };
TaxonomyLifecycle = { expectedRevision: number };
```

字段全部显式提供，null 表示清除主类目，空数组表示清除标签；这是小型元数据完整替换，不提供任意 JSON Patch 路径。不接受 archivedAt、revision 新值、actor、role、SQL 字段或资源路径。

领域服务建议为 `listProducts/readProduct/createProduct/replaceProductMetadata/archiveProduct/restoreProduct` 及 `listTaxonomy/createTaxonomy/renameTaxonomy/archiveTaxonomy/restoreTaxonomy`。写服务内部统一调用 withStudioWrite，不能由 Handler 做完旧 actor 检查后把未保护 repository 暴露为业务入口。taxonomy kind 是服务器路由选择的 category/tag 有限联合，不从用户字符串拼接表名。

只读服务逐请求复核真实会话和 studio:read，不接受客户端传 actor。RSC 身份/导航判断不能代替数据源授权；read-only 能读所有本运营空间 Product，不声称不同 Product 对其不可见。

## HTTP、响应及分页筛选

| 方法与路径                                               | DTO / 返回                                                |
| -------------------------------------------------------- | --------------------------------------------------------- |
| GET /api/studio/products                                 | 产品列表查询；200 分页结果                                |
| POST /api/studio/products                                | ProductCreate；201 ProductDto                             |
| GET /api/studio/products/[productId]                     | 200 ProductDto                                            |
| PATCH /api/studio/products/[productId]                   | ProductReplaceMetadata；200 `{product,changed}`           |
| POST /api/studio/products/[productId]/archive 或 restore | ProductLifecycle；200 `{product,changed}`                 |
| GET/POST /api/studio/categories 或 tags                  | 列表查询 / TaxonomyCreate；200 分页结果 / 201 TaxonomyDto |
| PATCH /api/studio/categories/[id] 或 tags/[id]           | TaxonomyRename；200 `{item,changed}`                      |
| POST 对应 [id]/archive 或 restore                        | TaxonomyLifecycle；200 `{item,changed}`                   |

所有写操作需要 session Cookie、session CSRF header、精确 Origin/Host 和 workspace:write；读取需当前 studio:read。沿用 no-store/private headers、无 CORS、server-only 边界，不新增业务 Cookie。

ProductDto 包含 id/slug/title/metadataRevision、createdAt/updatedAt/archivedAt ISO 字符串、primaryCategory `{id,slug,name,revision,archivedAt}` 或 null、tags 同类摘要数组。不包含凭证/DB记录/连接配置。TaxonomyDto 为上述目录字段，附只读 assignedProductCount（含归档 Product）用于归档说明；不把该计数当权限或并发控制。

列表 query 固定：`page` 默认1、整数1..1000；`pageSize` 默认20、整数1..50；`status=active|archived|all` 默认active；`q` 可省略，规范后最多80 code points。Product 另支持单个 `categoryId`、单个 `tagId`、`unclassified=true|false`（默认false）；unclassified=true 与 categoryId 同时出现拒绝，分类/标签同时使用为 AND。未知合法 UUID 筛选返回空列表，不当不存在实体错误。

q 对 id/slug/title（目录为slug/name）作字面子串查询，参数化并转义 LIKE 的 `%/_/\\`，不能让用户输入变成通配语言或 SQL。分类与标签使用 EXISTS/精确 FK 查询，避免 JOIN 造成重复 Product。

返回 `{items,page,pageSize,total,hasNext}`；稳定排序 `created_at DESC,id ASC`。每次 count 与 items 使用同一个短只读一致性快照；不同请求间不承诺快照分页，列表新增后可刷新。越过最后一页返回空 items 和实际 total，不伪造不存在错误。全部列表都有上限，分类/标签选择器用分页搜索，不一次下载全表。

## 错误码、并发冲突与未知提交

复用 P2-A 的 INVALID_REQUEST(400)、PAYLOAD_TOO_LARGE(413)、UNAUTHENTICATED(401)、ORIGIN_REJECTED/CSRF_REJECTED/CAPABILITY_DENIED(403)、STUDIO_UNAVAILABLE(503)。集中扩展稳定码，不返回 postgres 原始异常。

| 新码                                                    | HTTP / 含义                                         |
| ------------------------------------------------------- | --------------------------------------------------- |
| PRODUCT_NOT_FOUND / TAXONOMY_NOT_FOUND                  | 404，仅已认证后定位实体不存在                       |
| PRODUCT_ID_CONFLICT / SLUG_CONFLICT                     | 409，映射明确唯一约束；归档身份也不可复用           |
| METADATA_REVISION_CONFLICT / TAXONOMY_REVISION_CONFLICT | 409，保持用户未保存输入，重新读取后显式重提         |
| PRODUCT_ARCHIVED / TAXONOMY_ARCHIVED                    | 409，先恢复或选择有效新增引用                       |
| TAG_LIMIT_EXCEEDED                                      | 400，最多8个；与普通 DTO 失败一样不得产生部分写入   |
| REVISION_LIMIT                                          | 409，不进行溢出更新                                 |
| WRITE_BUSY                                              | 409，已确认锁等待超时且事务回滚；稍后显式重试       |
| WRITE_OUTCOME_UNKNOWN                                   | 503，提交结果无法确认，先读取服务器事实，不自动重发 |

错误 body 最少 `{code,requestId}`。CAS 冲突可额外带已授权的 `currentRevision`，只能由受控 DTO 输出；不回传输入正文或整行 DB 对象。B 流需保留此受控信息，不能将通用 raw exception 交给浏览器。

B1 不新建幂等表。Product 稳定 ID 和 slug 唯一防止重复创建；category/tag slug 唯一防止响应丢失后重试产生重复实体。客户端不对未知提交自动重试；创建后不确定时按唯一 ID/slug 查询列表/详情，确认是否存在；更新不确定时读当前 revision/字段，不能把“连接断开”直接显示为保存失败。CAS 检查本身不等于请求幂等账本。

## 真实 UI 与空状态

- `/studio`：现有身份/环境信息与真实“工作区”“类目与标签”导航；不显示未实现业务入口。
- `/studio/products`：分页列表、标题/稳定ID/主类目/标签/归档标记、筛选和创建表单。空库、筛选无结果、加载、失败与只读状态分开。
- `/studio/products/[productId]`：真实元数据表单及归档/恢复；创建成功后到实际详情。明确稳定ID不可改，slug和显示标题可改；显示 metadata revision 供冲突处理。只写“本阶段尚未接入草稿与导入”，不创建假草稿/导入按钮或虚假计数。
- `/studio/taxonomy`：分类/标签分页搜索、创建、重命名、归档/恢复、引用数量；选择器保留已归档旧关联的可见性并阻止新增。
- read-only 看得到数据与角色说明，不显示可执行写控件；直接调用同样由服务拒绝。
- 冲突时保留未保存表单，显示服务器已变化，提供读取最新内容后人工重提；不自动覆盖。不确定提交单独提示先核实服务器状态。
- 归档后立即有可见恢复路径。所有变更成功状态来自实际提交，不在请求完成前显示已保存。
- 检查320/375/390/430 CSS px：正文≥16px、交互目标≥44px、长标题/标签可换行、无水平溢出、键盘标签与focus明确。

## 文件所有权与共享前置提交

总控冻结本合同后再启动实现。A 首先交付共享鉴权/DTO/Schema 的独立提交，B 对该固定提交接入；不让两流各造鉴权或 SQL。

| 所有者      | 独占范围                                                                                                                                                                                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A：DB与领域 | `src/lib/db/schema.ts`、集中授权/追加迁移、四表DB测试；共享 `src/lib/auth/write.ts` 与必要的 auth 内部复用调整；`src/features/product/workspace/**` 的 server-only 服务/repository、浏览器安全DTO/schema及领域测试。A是SQL/Schema与共享业务鉴权唯一写者，不改变已审认证含义。 |
| B：HTTP/UI  | 新 Product/category/tag handlers；`src/features/studio/workspace/**`、工作区/目录页面及局部样式；HTTP/E2E/截图检查。复用A的服务和DTO，不执行直接领域SQL，不改迁移或复制auth查询。                                                                                             |
| 总控        | package/lock、CI/Vitest/Playwright等共享配置、根阶段文档、独占3100/集成实例、共享错误码与既有通用客户端的改动协调、集成和最终验收。                                                                                                                                           |

`StudioErrorCode/errorResponse` 与通用 studioFetch 当前字段有限：新增领域错误与 currentRevision 的支持由总控指定单写者集中完成，不能让两流各自增加不兼容处理。B可独占新的 workspace HTTP适配层，不能绕过既有来源检查、JSON读取和秘密脱敏。

所有写事务回调只做有限 SQL，设置有界锁/语句等待并映射 WRITE_BUSY；最终具体 timeout 常量由总控在冻结时确认。不得持 auth lock 跨文件或网络操作。未来B2媒体/文件工作仍在业务事务外，不能把本包装器包住完整导入过程。

## 必须执行的验收

- 迁移从P2-A升级、重放/checksum、失败回滚；授权清单重放不丢新表权限，也不扩大旧权限。app改身份/created_at、实体硬删除、DDL、审计改删失败。
- Product/slug身份边界、规范文本及最大长度、8/9标签、重复关联、slot数据库硬上限；包元数据与后台数据不会自动同步。
- 两连接同revision更新仅一成功；同内容/no-op、标签数组换序、旧revision同内容、revision上限；失败无部分关联和审计。
- taxonomy归档与新增分配双向竞争；旧归档引用保留/移除；Product/category/tag归档恢复、重复目标状态no-op、slug不释放。
- 先取得旧actor，再logout/disable或按同auth锁改变role，业务写必须按当前状态拒绝；反向顺序则已授权短事务先提交，停用随后生效。
- auth锁等待后、Product/目录锁等待后到期不得写入；提交前条件复核失败回滚领域修改与审计；touch不复活撤销会话。
- read-only直接HTTP和服务写均拒绝；缺错Host/Origin/CSRF、未知字段、请求超量、非法query/path、SQL/LIKE注入与分页限制。
- 提交结果未知不自动重写；恢复读取实际revision/唯一身份。审计只记真实变化、正确目标revision、当前actor/session，无内容和秘密。
- 真实生产构建的列表/创建/编辑/筛选/归档/恢复/冲突/只读/空状态，移动截图与助手图检；认证E2E继续关闭trace/HAR/video及敏感失败截图。

阶段收口执行 format/lint/typecheck/test/build/test:e2e 以及真实 test:db；配置缺失或连不上必须失败，不能静默跳过。区分本地结果、远端CI和人工验收，交付精确SHA、实际证据和限制。文档编写时上述B1检查全部待执行，未授予本线代码开发或部署权限。
