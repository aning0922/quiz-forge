# B2-1 原包接收验收计划

日期：2026-10-12。当前为验收计划，**没有B2-1实现或检查通过证据**。基线B1最终文档e8da98b的CI38169117712已成功，不能替代本阶段验证。实施范围与有限状态见[合同](STUDIO_P2B2.md)。

## 检查分层与责任

| 层级           | 必须证明的行为                                                                                                                                                               | 主责                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 纯单元         | strict DTO、canonical指纹、查询拒绝、错误投影、revision/fence溢出、有限状态；received仍not-run；权限/配置不能由UI推断                                                        | A定义合同；B验证HTTP与客户端 |
| 真实PostgreSQL | 最小列权限、FK与唯一约束、并发幂等、20个未完成意图、3次attempt、请求与冻结事实不可改、恢复新fence与旧attempt身份                                                             | A                            |
| 真实流/PG/文件 | claim确认前不读body；实际字节/hash/上限；暂停输入时身份变更能完成；流恢复后旧身份不能提交；storage try-lock立即busy                                                          | A；B验证HTTP适配             |
| 文件与故障     | 0700/0600、symlink拒绝、no-clobber、孤儿/双名/held配额、扫描数量/深度/时间和receipt限额；write/sync/close/link/unlink失败后的真实文件与DB事实                                | A                            |
| 断连与恢复     | claim/冻结/完成三个窗口；旧锁句柄失效；已提交但应答丢失；有效receipt/ESRCH与活PID；无停止证明不释放；重复恢复不重传或覆盖                                                    | A                            |
| 配置与HTTP     | v1/v2兼容默认关闭；真实CLI启停、锁忙与原子替换、丢锁晚到rename/旧guard回收晚到unlink、残留恢复guard阻断；Host/Origin/CSRF、当前能力、settings/no-store、201/200、精确key核实 | A配置；B接口                 |
| 生产浏览器     | disabled、只读、空列表、上传、received、拒绝、未知提交、显式核实/恢复；320/375/390/430实际图检；无后续未实现按钮                                                             | B编写；总控运行与图检        |

## 夹具与证据要求

- 新增表后同步测试reset的显式表清单。文件清理仅限已核实test/ci实例的受管uploads、没有活动写者且确知归属的文件；不能递归清除实例根。
- 接收测试使用可暂停流及窄的内部故障适配器，无生产HTTP测试开关。系统调用可注入ENOSPC等错误，但必须检查真实文件与账目；不得实际耗尽磁盘。
- HTTP取消需要覆盖尚未开始generator、在途read、cancel挂起/拒绝及迟到reject。未确认所有相关操作settle时，不得产生stopped receipt或释放预留。
- 至少一个“已提交但应答丢失”案例由独立PG连接确认提交后，再观察调用者的unknown结果；浏览器route.abort或提交前断连不能替代该证据。
- 活PID/ESRCH用本测试拥有的受控子进程验证；EPERM/PID复用可单测适配器，明确证据级别。不检查或杀死未知进程。
- 时间边界主要用受控时钟/调度验证，保留至少一个真实流期限案例并单独提高测试超时；不放宽生产限额迁就测试。
- 所有secret、随机凭证/会话/CSRF、连接配置留在内存或私有文件，失败输出只给固定码/安全断言；不得dump异常对象、SQL参数或认证DTO。

## 总控集成与退出条件

生产E2E使用独占3100、生产构建和reuseExistingServer:false。新增studio-imports串行project依赖studio-workspace，从普通mobile/desktop项目排除；trace/video/自动失败截图关闭。只主动保存空凭据或不含凭据的状态页面，记录视口、状态、浏览器与实际检查结论。

完成后执行format:check、lint、typecheck、test、build、test:db、test:driver、test:e2e；build必须检查包含uploads在内的私有路径追踪。独立Astra审查与整改后提交/推送、建立依赖B1的Draft PR并核实准确head的CI。当前远端CI有普通检查与真实数据库/驱动任务，**没有浏览器任务**；E2E按本地证据记录。

收到原包不代表ZIP/content/Product归属/synthetic/图片/授权已验证，也没有生成草稿、批准内容或发布。B2-2再接P1实际验证与资源归档，B2-3再应用首稿。

## 实际结果

待实施后填写精确SHA、逐项结果、独立发现、截图与CI。当前未执行本阶段测试，不宣称完成。
