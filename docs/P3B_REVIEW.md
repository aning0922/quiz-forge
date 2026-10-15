# P3-B 实施与独立审查记录

日期2026-10-16。基线P3-A交付0059175，运行ce190cd已经技术验收；本文件只记录P3-B准备/实施，不是验收。

A/B两条独立Sol只读预研已核真实ZIP入口、候选/恢复、policy/SQL/首稿和历史链；主控据此冻结PACK_ADMISSION_P3B，Astra独立复审。首轮P2指出“非终态一概拒绝”会使三次耗尽但已停止释放的合法旧记录无法升级。按真实storage/reservation/lease/attempt/停止证明静止条件修订，旧validated/retryable-failed保留只读，新key完整重验；20pending限定当前policy精确version/hash，1024总行及磁盘继续跨policy。主控/A共同核现有countCapacity，旧规则确实会永久占位，不能靠改旧状态绕过。

独审要求旧写者/受管IO先退出，事务内NOWAIT两表锁、拒绝残留应用连接、核旧helper后同事务检查/DDL。整组identity/report/hash/policy和content/component矩阵绑定，避免分别union的错配；新issue collector保留上游截断，不误套旧“恰100项”条件。Astra复审确认合同P2关闭、无新增合同阻断；两处表述（identity报告Schema hash、pending统计例外）已校正。真实PG/两平台/生产E2E均仍待实施验收。

首个共享交付为package/api.ts与compatibility.ts，只提供相关联合/必填完整版本签名和冻结两profile描述符，尚无准入执行。主控类型/定向lint/格式通过；Astra独立内存TS负向探针拒绝混代、漏版本/短版本、额外policy及新报告赋旧类型，递归9对象/数组冻结和3变异拒绝通过，独立canonical hash为a1366418639c8eac052955dae4670cf179a7c9774c8039f66cc46f78252c2899。可交B实施package M1，桥接仍待后续共享报告/身份机器合同。P3-A文档0059175普通38774143564与媒体38774143579也均实际success。
