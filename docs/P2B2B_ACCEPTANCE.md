# P2-B2-2B 技术验收

日期：2026-10-15。验证基线 `8b21ddf62c31d8393a89b96ff5ea75008ed1a3fd`；后续仅调整 fullPage 截图前的滚动位置及验收文档。独立审查登记的 P1/P2 已关闭，正式材料批准和历史人物首款内测尚未完成。

## 本批能力

Studio 已接入真实 prepare → 显式 start、验证历史/详情、私有资源归档、ACK 与保守恢复流程。原包 received、验证 ready 与后续草稿分别表达；ready 只表示本批允许的 synthetic/content.v1 候选及其 Product 资源已完成归档，不代表内容/素材获批、生成草稿、评分或发布。

归档使用私有候选文件、原请求实际 IO 停止观察、独立 DB ACK 和一次终结门。缺 ACK、媒体停止未确认或写结果未知时保留配额和现场，不能用进程退出、空 control、重复请求或测试清理 marker 代替业务停止证明。完整合同见 [STUDIO_P2B2B](STUDIO_P2B2B.md)、[B2B_VALIDATION_ADAPTERS](B2B_VALIDATION_ADAPTERS.md)、[B2B_PENDING_UI](B2B_PENDING_UI.md)。

## 实际验证

| 检查                 | 实际结果                                                                              |
| -------------------- | ------------------------------------------------------------------------------------- |
| 格式 / lint / 类型   | 全部通过；截图修订另通过定向格式/lint                                                 |
| 单元                 | 82 文件、1060 项通过                                                                  |
| 普通 PostgreSQL      | fresh 实例 29 文件、298 项通过；154.22 秒                                             |
| 真实驱动故障         | ESM/CJS 共 46 场景通过                                                                |
| 服务 PostgreSQL 专项 | validation 10 项、media-unknown 3 项，各用独立 fresh 实例；实现流本地与 GitHub 均通过 |
| 生产构建             | 通过、零 tracing warning；59 trace / 11357 路径 / 零私有路径违规                      |
| macOS 媒体隔离       | 当前 main 目标 66 项连续三轮通过，provision 封存成功                                  |
| 生产 Chromium E2E    | 214 通过、10 既有跳过；新增后台 8 场景全部通过                                        |
| 截图复拍             | fresh 实例真实 ready 场景另 1 项通过，四宽重拍；未修改业务行为                        |

本机普通数据库、驱动、浏览器按主控串行执行。专项测试只替代媒体绑定及解码边界，仍真实运行候选/ZIP、私有文件与数据库事务；不能替代实际 HTTP 与媒体隔离证明。其 COMMIT 响应丢失用例是实际提交后在方法边界注入错误，不冒称真实网络中断；驱动套件另覆盖真实断开行为。

macOS 已封存部署 SHA 为 `6860b90947001aac7443881864511f57cd99fbd3ff96bee2513e91d5af1268e3`，runtime bundle SHA 为 `ffd72db43adfbd1fc50ceae812e3e7a7d96525193905b7de88c8f3b769f17c95`。一次构建缓存超过已有文件上限时保留迁出生成的 cache，前后 1215 个非 cache 运行文件摘要不变；没有放宽媒体硬化限制。

`8b21ddf` 对应 GitHub [普通检查 38720516687](https://github.com/aning0922/quiz-forge/actions/runs/38720516687) 的 checks/database 均实际 success；数据库 job 内 298 普通、46 驱动、10 服务、3 UNKNOWN 三套独立数据库步骤均完成。[Linux 媒体隔离 38720516815](https://github.com/aning0922/quiz-forge/actions/runs/38720516815) 实际 success。此前付款/额度阻断只保留为历史，不能覆盖现在的实际成功结果；最终文档 head 的 CI 另按 PR 状态核实。

## 浏览器及截图

Chromium 156，生产构建，独占 127.0.0.1:3100。新增 8 场景覆盖实际 ready、ACK 已确认但响应丢失、首 fetch 前已持久 sent、损坏 pending、只读、imports 关闭、Product 归档和已保存 false 的显式继续。四宽断言检查 320/375/390/430 CSS px 无横向溢出、区域正文不小于16px、按钮高度至少44px。

[截图目录](qa/p2b2b-2026-10-15/) 保存六种状态各四宽，共24张：ready、unknown-empty-get、persisted-before-fetch、disabled-prepared、read-only-unknown、archived-unknown。两条独立实现流逐张查看24图，主控重查修正后的ready四图：卡片及按钮完整，长 ID/SHA 换行，未知提示未误称回滚/未发送，无可见凭据或私有路径。只有合成记录 ID、摘要 hash 和截短请求标识。

首次 ready 四图曾有固定 skip-link 遮挡 SHA。最小 Chromium 复现确认：未聚焦且 top=-100 的固定元素，在中间 scrollY 的 fullPage 捕获中被错误画入整页；从顶部拍摄不出现。测试仅加入 scrollTo(0,0) 与等待滚动归零，独立窄审通过；fresh 实际 ready 复拍四图均无遮挡。没有隐藏元素、修改焦点或生产 CSS。其余20图不受此问题影响。

以上是助手实际像素检查及浏览器断言，不是作者人工视觉、内容或商业批准，也不替代 iOS Safari/Android 实机验证。

## 隔离现场与后续

最终普通回归实例 `a3ab3ba28a93316a0230d1614f457f2e` 已停止。完整浏览器实例 `833c5500efbac556d6012dd2b8fdeb61` 和复拍实例 `c213330050664f60d690004744a0ce2d` 均在自有 Next 实际退出后，使用受审的跨进程精确 fixture 清理成功，再停止数据库。旧失败/UNKNOWN 实例保留且停止，不以新成功覆盖旧结果。3100 不保留服务。

[Draft PR #13](https://github.com/aning0922/quiz-forge/pull/13) 继续堆叠在 #12，未合并 main。按作者持续授权接续 B2-3 首个持久草稿：先冻结来源/三表/幂等/正文响应/pending 合同，再两条实现流与独立审查。历史人物四卡内容、素材与发布批准仍保留人工闸门。
