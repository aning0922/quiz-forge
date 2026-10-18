# P4 专属 fixture 接口

状态：prepare/read/finish/cleanup 与受限CLI已实现；专属物理来源和operator-services生命周期已实际验证，完整consumer-e2e仍待消费者服务与生产浏览器用例。类型在 `p4-consumer-fixture-contract.ts`，实现路径固定为 `p4-consumer-fixture.ts`。运营子测的finished不代表正式completed。

实现导出 `prepareConsumerFixture(db, runId)`、`readConsumerFixture(db, runId)`、`finishConsumerFixture(db, runId, observations)`、`cleanupConsumerFixture(db, runId, ServerExitProof)`。prepare只建独立 `consumer-flow-fixture` 的r1/head，通过正式recordBaseline/sealInternalVersion服务落账父版本，真实读取字体和五个私有合成PNG文件，不预造play/Key/session/report成功。operator/readOnly凭证仅放当前instance的0600私有fixture文件。合成媒体资格保持no-native-validation。

Playwright进程只import合同，按P3-E模式以 `node --conditions=react-server --import tsx tests/db/p4-consumer-fixture.ts prepare|finish <runId>` 调CLI。CLI实现只接受这两个动作和UUID；不收路径、凭证或正文参数，不在stdout打印结果正文。finish从同一instance固定0600文件 `consumer-p4-e2e-observations.json` 读观察；最终manifest固定为 `consumer-p4-e2e-fixture.json`。两个文件均≤2MiB，验证mode/owner/非symlink/instance/runId，失败保留现场。root runner可在实际server退出后直接调用read/cleanup，并先清P4，再P3-E及更早fixture。

`ConsumerFixtureObservations` 精确字段：`schemaVersion`、`instanceId`、`runId`、`productId`、`mode`、`suiteCompletion`、`plays`、`keys`、`states`、`reports`、`grants`。每类按ID唯一、全归属独立Product，有数量与总字节上限。mode=`operator-services`仅用于领域服务子步骤，不表示消费者完成；正式生产E2E必须用`consumer-e2e`且至少包含一个play、Key、state、report和grant。`finished`仅表示fixture观察/所有权manifest封存；`completed`只有finished且mode=consumer-e2e、有实际report并通过有限完成摘要才为true。root正式runner须同时要求completed、consumer-e2e与实际report；operator-services不能计为P4 E2E执行。

- plays：实际create/read/resolve响应核验后的 `InternalPlayReceipt`，不得凭DB扫描把未知play加入。
- keys：实际issue/read/list/resolve/void响应核验后的最终 `AccessKeyDetail`，每Key保留最新已验证观察，保留原issue绑定。
- states：实际bootstrap/save/resolve响应核验后的每session最终 `ConsumerState`。完成前先保存该最终state；完成视图中的report receipt不能代替答案/state事实。
- reports：实际complete/resolve/report响应核验后的 `PersistedReportReceipt`，并与对应最终state/Key/play相互绑定。
- grants：`source='verified-bootstrap-and-cookie-digest'`、`grantId`、`session`、`credentialDigest`、`issuedAt`、`expiresAt`、`logoutObserved`。grantId和时间来自已核验bootstrap；测试Node可通过browser Context读取对应HttpOnly cookie，仅在内存调用 `digestConsumerToken(raw,'grant')`，立刻丢raw。不得写raw到观察文件、CLI、截图、断言或工具输出，也不保存CSRF。只有收到并核验该exact grant的logout成功，才能设logoutObserved=true。轮转后不在DB的旧观察可以保留，但每个当前grant必须匹配实际已观察的ID/digest/绑定，不能扫描Product所有grant再“收养”。

finish须核验实际持久行和以上来源，未知ID、额外consumer行、错actor/绑定/hash或不完整来源全部拒绝，不补造观察。manifest只存固定表的row主键/完整行SHA，不存raw cookie或报告正文。cleanup再次核完整图/共享资源/文件/无活跃writer及真实ServerExitProof，在首次DELETE/unlink前完成全部证明；created=false的既有blob不删除。某次写入或关闭仍UNKNOWN时保留fixture，不清库凑绿。

有限完成摘要 `suiteCompletion`：operator-services必须null；consumer-e2e必须提供 `quizforge.consumer-fixture-suite-completion.v1`、同runId及固定8个case各一次（CONSUMER_E2E_CASES）。每项status/expectedStatus均passed、retry/repeatEachIndex均0；未知、重复、遗漏、skip、expected fail和retry均不能finish。B沿InternalSuiteCompletion实际testInfo记录生成，不以Playwright总退出码代替。固定cases覆盖运营play/Key、exchange/entry、save/resume/recovery、completion/report锁、授权资源/PNG、隔离/logout、unused/claimed void、source/cookie边界；真正server expiry另由PG证明，不用浏览器快进冒称DB时钟。
