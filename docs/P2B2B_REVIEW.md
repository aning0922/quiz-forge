# B2-2B 审查记录

本页记录真实问题与关闭依据；合同前置审查不等于实现验收。

## 前置合同（基线844054c）

- P2：已有key重放若先检查当前平台，会在部署变更/平台guard未知时阻断原事务查证。主合同第4节改为当前授权+enabled后先exact K，命中不做platform/capacity/CAS准入；claim再次查询覆盖迟到提交。独立Astra在01a12e04-6373-7102-966e-94f15924d7c3闭合。
- P2：evidence_text非空而hash为NULL可使旧CHECK结果NULL而通过。新增双非空分支及整体IS TRUE；同轮独立复验闭合。
- 澄清：同fence允许lease清NULL，禁止设置/改变非空lease；空report_texts合法，非空才检查数组维度与下界；archive retry必须在claim前settled平台查询，claim后restore无平台调用，ESRCH不代替媒体停止。这些边界已通过同轮只读复验。
- 公共适配器：prepare/restore/SQL evidence projection复用A单一算法与预算；opaque prepared绑定同ctx且单次消费，restore不生成新报告，serializer按真实文本计量。前置未发现剩余可证P1/P2。
- UI独立Astra子代理复验：采用单bucket、有界UTF8、同步发送门与readback、exact tuple核实、空GET仍未知及compare-and-remove。旧receipt只用内存状态，不直接复用为刷新恢复；详情已写B2B_PENDING_UI。
- StartValidationResult增加record与严格preclaim not-started结果；通用HTTP错误不清pending。独立Astra在01a12e07-1e35-7060-9359-6233b7819b76已确认其与claim边界相容、无新增P1/P2。这里COMMIT边界专指validation claim，不禁止此前只读事务结束；未执行迁移/DB/native/build。

## 实施审查

公共代码已开始独立审查，仍无阶段验收结论。

- Root早审ad8a116：heldValidations的SELECT *会把1025条完整候选与报告搬入计量内存。4f09aba改为最小列，列表也只选摘要需要字段；strict asset-set与实际字节上限替代类型断言。
- Root早审ad8a116：validationKey的对象spread允许宽对象额外字段改变hash。4f09aba改为严格七字段Schema及显式canonical payload，拒未知字段与schemaVersion覆盖，边界用例通过。
- Root复验4f09aba：joined Product/id/version字符串排序与A逐id/version比较不等价，a及a-cover前缀可误拒。30d0bd6改为逐字段ASCII顺序并加合法/逆序/重复测试；root4项repository及3项DTO测试通过。
- V公共821bd296集成为1807559：prepare、opaque prepared、SQL serializer及engine scope抽取，root相关7文件66项纯测试通过；restore尚只有明确函数类型，无伪runtime桩。Astra首代码独立复验进行中。
- 新远端CI38197814487/38197842129为计费或支出上限阻断，job没有执行任何step；不当作代码检查结果。

### 公共适配UNKNOWN复验

Astra在首公共审查中用真实ctx复现：finite binding unavailable触发stop的同步abort listener可将ctx升级STOP_UNCONFIRMED，prepare及普通validate却沿旧局部状态输出无需维护。V de08f71→root d6f2030统一在最终completion、code和runtimeFailure吸收全局UNKNOWN；root42原相关测试与3个新增回归通过。独立Astra在01a12e1c-b89c-7c10-a7e8-b8cc5627586e重跑7个原/补充探针并关闭唯一P2，有限unavailable对照不变，迟到completion不降级；同轮窄读4718097 policy/ledger未见剩余P1/P2。此结论不替代FS/DB/实际媒体验收。

S操作内核3366443/76852da已集成68c2dd7/c1ffcc3，root11项纯测试通过；强制confirmed claim才可进candidate，receipt门核共享UNKNOWN，media unknown关联IO也保持unconfirmed。独立审查进行中；统一scanner/receive接线fee282df等待D迁移同批集成，避免缺表中间态影响旧receive。

### 归档完成前停止证明的合同补充

Astra在01a12e28-f467-7cf0-aeba-3d1b62294c2a确认receipt-before-complete可采用，并要求文件/媒体门、唯一receipt例外、一次DB finalization三个内部门；原业务期限不可借cleanup延长。主合同4.3已明确receipt只证明files-and-media，后继DB与连接关闭仍须观察，fixture不能凭此单独销毁活动请求。正常complete之后零文件/媒体IO；失败/取消receipt不新开事务。此为实施细化，不是新功能验收。
