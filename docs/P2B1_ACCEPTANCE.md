# P2-B1 验收记录

2026-10-12（Asia/Shanghai）。**已完成技术验收。** 总控分支codex/catalog-workspace，基于P2-A最终38177fb；最终代码为 `44a0d38c781feb9ea65156dab094a2c9f8907257`。[Draft PR #9](https://github.com/aning0922/quiz-forge/pull/9)堆叠于codex/studio-foundation，未合并main。范围见[实施合同](STUDIO_P2B1.md)，独立审查见[P2B1_REVIEW](P2B1_REVIEW.md)。

## 实际交付

- qf.product/category/tag/product_tag四表，稳定Product ID、单一主类目、8-slot标签硬约束、metadata revision、可恢复归档、唯一身份及有限审计。追加0002–0005，未改已应用0001 checksum。
- 11个真实领域服务与12个路由文件/16个HTTP业务方法。写入同事务重验当前身份、权限、有效期和CAS；auth→Product→目录固定锁序，旧归档关联可保留/移除，新分配要求active。
- `/studio/products`、详情和`/studio/taxonomy`，支持创建编辑、字面搜索、分页、筛选、归档恢复及只读。冲突保留输入；未知提交按固定ID或精确slug核实，不自动重发。新建目录不能自动丢弃其他行草稿或待核实状态。
- Unicode/UTF-16与SQL文本一致性、管理停用时间的微秒精度修复。固定postgres3.4.9补丁封锁断连后的旧事务/reserve/savepoint/cursor工作；稳定失效标记与cause用于准确区分未知结果，临时主动关闭客户端的规避已移除。
- `pnpm build`自动审计实际NFT追踪路径，排除本地私有状态、配置及测试产物。数据库CI增加真实驱动故障回归；依赖版本和补丁哈希固定，维护边界见[P2B1_DRIVER_PATCH](P2B1_DRIVER_PATCH.md)。

## 最终总控验证

以下结果均针对最终集成代码44a0d38执行，不将各实现分支数字相加。

| 检查              | 实际结果                                                                           |
| ----------------- | ---------------------------------------------------------------------------------- |
| pnpm format:check | 通过                                                                               |
| pnpm lint         | 通过，零warning                                                                    |
| pnpm typecheck    | 通过                                                                               |
| pnpm test         | 35文件、528项通过                                                                  |
| pnpm build        | 通过；自动trace守卫46份清单、0私有路径违规                                         |
| pnpm test:db      | 10文件、154项真实PostgreSQL18.4测试通过，54.05秒                                   |
| pnpm test:driver  | 46项ESM/CJS故障与兼容场景通过；缺配置不得skip                                      |
| pnpm test:e2e     | 198项生产Chromium测试通过、10项既有跳过，约1.1分钟                                 |
| 独立Astra审查     | 全部登记项闭合，无剩余P1/P2；最终定向69纯测试及29项无DB事务探针通过                |
| 实际浏览器图检    | 320/375/390/430四宽及冲突、未知结果、归档、加载、读取失败状态，见P2B1_VISUAL_CHECK |

代码head的[CI 38168728761](https://github.com/aning0922/quiz-forge/actions/runs/38168728761)已核实completed/success，checks与database两个job均成功。后续纯文档交付head的CI单独在PR核实，不用本代码CI冒充不同head的结果。

根检查日志位于忽略目录`.cache/p2b1-final-db.log`、`p2b1-final-driver.log`、`p2b1-final-e2e.log`。认证截图均为空凭证或登录后的非秘密界面；trace/HAR/video/自动失败截图关闭。完整E2E生产服务器独占3100、不复用未知服务；workspace项目依赖studio-auth，fixture不并发清库。

## 失败与修复的证据

初次目录文本策略存在SQL与DTO差异，追加0004/0005修复，并拒绝会被UTF-8静默替换的孤立surrogate。管理停用竞争曾两次出现session_times/23514，已捕获并定位OID1184日期serializer截断微秒，改为先绑定OID25后由PG转换；固定精度及真实管理回归验证原因。

原生postgres3.4.9真实事务超时曾触发nextWrite空socket未捕获异常；固定补丁与原始包对照、真实断连/替代连接及错误标记回归已覆盖。原有相同error对象推断回滚的漏洞在独立探针中复现，最终接入以稳定失效标记优先分类，不盲重试。

首轮后台E2E为5通过/1失败/5未执行；CAS用例可能命中导航前列表的同名表单。改为实际URL、详情标记和form限定后，提交前及409后输入断言均保留并通过。目录自动刷新丢其他行草稿是真实产品问题，已另加保护与真实E2E。窄屏移除按钮折字和构建trace链接边界问题均已修复、复审和验证，详细链路见P2B1_REVIEW。

## 边界与下一步

这是精确loopback、单运营空间的本机内测后台，不是生产连接、远端安全部署或消费者正式服务。没有导入、草稿/资源持久化、评分、AccessKey、发布或支付。目录revision不代表内容版本；代码/自动检查不授予内容效度、人物素材、字体或商业发布批准。

总控purpose=test实例b014361dd7f84f82cd6591a335f9ce83已stop/status确认停止；A、B与driver各自55421/55422/55424实例均已停止。私有配置/数据保留可恢复，不进Git，3100由测试框架退出释放。

按已获P1–P5托管授权接续B2：意图与受限原包接收→服务端复验/资源归档→首个草稿及CAS→B3有限编辑恢复→P2-C结构预览送审。接收提案与拟冻结合同只描述下一阶段，不属于本次已实现功能；无需重新申请普通工程启动授权。main合并、生产迁移/部署、真实内容/素材与发布仍保留必要人工闸门。
