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

尚未开始；无实现验收结论。
