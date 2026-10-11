# P2 数据库与后台预案

2026-10-12，Astra high 只读架构预审后的总控收敛。状态：预案，未建数据库/表/认证/后台；P1 技术门槛通过后，按其最终接口冻结各里程碑实施合同。作者 P1–P5 连续工程授权已生效，不需要重新请求普通开发启动许可。

## 后台组织和范围

一个 Product 是一个测评工作区，题目、规则、结果资料、草稿版本和私有资源均在其下。数据库 Product ID 沿用包的受限稳定字符串；draft/import/session 等内部记录使用 UUID。不额外创建与 Product 重复的项目实体。

运营 Category 与视觉 Theme 分开。P2-B 实现一个主类目、至多 8 个运营标签、真实创建/重命名/归档/分配和筛选；类目不做树形 CMS。未分类可保存，送审前明确分类。关联中的类目/标签不硬删除，归档后不再新增引用。Product metadata_revision 与内容 draft revision 分开：换运营标签不能偷偷修改题目 hash。包中的 categoryId/tags、slug/title 是该包版本声明；不允许上传者自动创建运营类目或覆盖工作区目录元数据。后续发布另冻结公开目录投影。

P2 为 loopback-only 内测：仅本机合成包、显式绑定 127.0.0.1、严格 Host/Origin、无反向代理/隧道/LAN，上传默认关闭且远端 profile 拒绝。媒体进程不具备 OS 沙箱/RSS 硬限制；开放远端上传前单独验收无网络、无凭据与 CPU/内存/进程/磁盘硬限制。原包、staging 和资源均在私有目录，逐请求认证读取，不放 public。

## 三个可验收里程碑

| 里程碑 | 真实交付                                                                                                           | 门槛                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| P2-A   | 独立本地 PostgreSQL 生命周期/迁移、运营身份/会话/审计三表、本机高熵凭证 bootstrap、登录/退出、真实 Studio 环境入口 | 真实迁移重放/失败回滚、应用角色限权、撤销/过期、CSRF/Host/Origin、配置缺失关闭；既有页面可构建 |
| P2-B   | Product、目录、不可变草稿 revision、受限导入、资源归属和持久化补偿；实际列表/编辑/筛选/导入状态                    | 两连接 CAS 冲突、no-op、同版本不同 hash、幂等、跨 Product 引用拒绝、文件/事务故障恢复及真实 UI |
| P2-C   | 当前候选结构/资源预览、适用验证证据、指定 revision 送审/退回                                                       | 编辑与送审竞争、旧证据拒绝、权限绕过、私有资源读取、移动截图；不得冒充评分/真实组件预览/发布   |

每个里程碑实施后做针对性数据库/安全测试、六项工程检查和非实施上下文审查，记录精确 SHA/实际 CI。不一次建立所有未来实体，不在页面显示假成功按钮。

## 数据与不变量

P2-A：operator、operator_session、audit_event；凭证和会话只存摘要。bootstrap 仅生成随机高熵凭证，不接受用户自选低熵密码；会话轮换、撤销、绝对及空闲到期。Cookie HttpOnly/SameSite、无 Domain，本地 HTTP 例外独立 profile，不传播生产；所有写接口含登录/退出都检查 CSRF 和固定 Origin/Host。后台身份独立于未来消费者授权。

初期单运营空间，全局角色明确 operator/read-only；不宣称逐 Product 人员 ACL。各服务检查实际权限，不以隐藏按钮或 layout 代替授权。Product 之间内容/资源归属由复合 FK 和严格合同保证。

P2-B 增加 product、product_draft、draft_revision、quizpack_import、asset_blob、product_asset、category、tag、product_tag 九表。draft_revision 只插入；草稿指针比较 expected revision 后移动。canonical 同内容 no-op 保持 revision/证据。所有 hash 服务端重算；版本资源 immutable。JSONB 保存有界版本化内容及文件事实，JSON 内引用由严格验证服务检查，不宣称它们都有 SQL FK。

import 记录同时容纳不可变技术证据、原包/派生包关联、幂等指纹、lease 和补偿进度。不同验证产生新记录；完成后报告不改写。包身份唯一 (product,packId,packVersion)，同身份异 hash 拒绝。同幂等键异输入冲突；重试不覆盖编辑中草稿。asset blob ready 仅证明实际字节存在且匹配，不授版权/商业批准；product_asset 固定归属、资源版本和 provenance/许可 claim。

P2-C 增加 review_request，绑定 Product/draft/revision/contentHash/assetSetHash/evidence；事件存 append-only audit。只支持 submitted/returned；评分、可达性、组件渲染、素材授权和作者审批继续列为未验证。P2 没有发布/Key 或 commercial approved 按钮。

## 导入和故障恢复

认证/权限/CSRF/限速/总并发与磁盘配额 → receiving 短事务 → 有界接收私有暂存并冻结 SHA → 在同一冻结字节上重新调用 P1 → 私有不可覆盖 blob → 短事务建立资源/证据/草稿 revision → staged。禁止跨解码过程持有长数据库事务。

不能信任客户端报告，不能验证后用另一套通用 ZIP 解压器读取。P2 内部适配器复用 P1 的受限读取，返回与相同 archive SHA 绑定的 content/assets。P1 importable:false/publishable:false 语义不变，P2 的 staging 是单独服务端权限。

对象存储与数据库不是一个原子事务。复制后 DB 失败、DB 提交后响应丢失、处理进程中断都必须持久化状态并恢复；清理器可重复执行，不能删除仍被成功导入引用的去重 blob。当前草稿编辑后的验证用受控派生包重新检查内容与资源，保留原包证据，不能拿旧报告套新 revision。

## 开发分工和环境

总控逐里程碑冻结 DTO/错误码/权限、迁移决策和共享配置；普通实现仍分独立 Sol high 会话，A 数据/应用服务/私有存储，B 认证/HTTP/Studio，Astra high 审查。数据库基线可作为独立前置实现交付，迁移单写者，避免两流生成竞争表。

只初始化不存在的项目专属 PostgreSQL 18.4 集群，专用非 5432 端口/socket/目录；不用 brew services，不访问现有 DB、改全局设置或 ~/.pgpass。迁移角色与应用角色分开，迁移带版本/checksum/串行锁，测试库与人工演示库分开。构建不依赖数据库在线。清理验证专属路径和集群标识，生产迁移/部署不在授权内。

远端身份服务、真实经营凭据、正式商品内容/素材、作者审美、main 合并及生产部署到实际需要时才形成可审决策。目前这些不是本地 P2 工程的阻断。
