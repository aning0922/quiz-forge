# B2-3 独立审查与集成记录

日期：2026-10-15。冻结合同为 [STUDIO_P2B3](STUDIO_P2B3.md)。本页记录实际证据与尚未完成的验证，不等于阶段验收。

## 独立聊天接续

作者要求恢复独立开发和审查聊天后，数据线 `01a13f49-bff9-74b0-8f7c-03cd46b346c1`、界面线 `01a13f4a-3ac5-7a72-9ae0-70b24ec85f04`、Astra审查线 `01a13f4a-c9f8-7cc3-9558-81f86263cad1` 已接管各自受管工作树。原子代理的成果、失败现场和停止实例保留，主线未继续使用子代理替代独立聊天。

数据原交付至 `ed79a99`，接管后 `44e5d8a` 补旧policy/ACK错配、Unicode原文保真与原key跨当前操作员重放；主控分别集成共享fixture、PG服务/SQL及补强为 `16ddad6`、`a606170`、`2e23beb`、`777c630`。A最后34项定向PG及后续13项服务PG通过，来源/服务39项纯测试通过；不是主控全量验收。

界面原交付至 `17e886d`，接管后 `97d2529` 补持久回读改动零POST、迟到回执不删替换锚点、鉴权失败保留原tuple，生产浏览器用例增至8项。主控集成至 `889c0d4`；后台实际路由绑定真实factory，无fallback service。

## 已关闭问题

1. **FK定义存在但内部执行触发器可能被禁用。** 主控 `a141329` 增加 conenforced、每个FK关联的四个内部触发器启用检查，以及helper严格性、返回类型、语言与权限核实；四条循环FK采用NO ACTION延迟检查，外部关系仍RESTRICT。`c145fc8` 的专属新集群探针实际禁用cycle/source内部触发器，原constraint文本/validated保持不变但app拒开，恢复后可开。Astra在自己的隔离工作树独立运行两项成功，原P2关闭。首次探针把initdb --version误判为初始化，失败发生在创建实例前；修订后真实结果如上。
2. **清理夹具误判自己的StorageLock连接。** `17e886d` 保守检查所有其他PID后，未排除独立锁连接，Astra实际仅admin/app/lock三条自有连接也被拒绝。`4fc131f`（主控 `59594be`）从当前持有lock.connection核实PID/数据库/角色，仅排除精确自有锁，其余全部PID仍拒绝。Astra复用原失败现场清理成功，独立探针确认额外app连接存在时零删除、实际退出后成功，新PG回归1/1与51项UI纯测试通过，P2关闭。

独立清理探针曾错误要求全库审计为空；两条匿名preauth_created记录不属于fixture actor，保留正确。修订仅收窄测试期望，不删除不属于夹具的审计。未把该探针错误当作产品缺陷。

## 当前集成证据

主控 `904942e` 已接入全部上述代码，Playwright新增独占serial `studio-drafts`项目并依赖`studio-validations`，公共桌面/手机项目明确忽略后台spec。归档说明改为显式应用首稿，并同步旧浏览器断言。

主控格式/lint/类型与91文件1162单元全部通过，已推送Draft PR #14。fresh实例cd266b2e93227f675713177f7e81f8cf的34文件335项PG通过，46项ESM/CJS真实driver通过，随后实例停止。main生产build成功，65trace/12941路径/零私有违规；control.ts的受限.cache路径表达式产生1条动态tracing性能warning，不能写作零warning。八项新场景及全E2E/四宽图检仍待完成。独立审查本轮无剩余已登记P1/P2，不代表这些运行验收已通过。

904942e的GitHub普通CI38740158942（checks/database）及媒体CI38740158941均实际success。首次main绑定因生成cache累计138220888字节超过128MiB硬化总量而LIMIT_EXCEEDED、未提交；保留迁出32个生成cache文件，前后1313个非cache条目（含符号链接目标）完全一致，未扩大限额。绑定成功部署988d02c3087ac2dd6cb1b49b572ba81ca7d14b64bb3e489c6f18c8ce2bdada67、sourceBundle a8d51ff44715fdd6a243da1c2e1d15fd8eb575264379ca4c75b3639a44fde181，740artifact/1034source，总33086530字节。

首次provision前两轮66/66，第三轮65/66，bounded fault success-hang失败；全部66项跑完、control残留0，但矩阵将任何失败保守标记ownedOperationsStopped=false，因此provision返回MATRIX_STOP_UNCONFIRMED、未封存。失败summary保留。原失败未记录返回code，不能事后推定为哪一处断言；相同代码/500ms预算另6次定向实跑均DEADLINE_EXCEEDED、stopped=confirmed、输出87bytes、514–525ms，无control残留，也未观察到自有runtime进程。保持代码和限额不变，正在完整重验三轮；不能用6次局部通过代替封存。

专属B3浏览器fixture只有合成DB资格，未执行媒体；大正文只测试历史合成快照的2MiB持久预算与真实JSON响应预算，不声称当前P1可发行原content超过1MiB的新包。最终维护须在自有Next实际退出后按B3→B2顺序精确清理，失败/未完成manifest或其他连接未退出时保留现场。

## 最终布局与运行复核

上述原代码媒体完整重验三轮66/66并封存成功。随后真实完整生产浏览器222通过/10既有跳过，8新增全部通过。首24图逐像素检查发现按钮相邻无间距、归档回执320图仅900px截取；原图保存在私有cache。独立UI 2a48280→root870c976为三处动作组复用12px gap/flex-wrap，并为末尾刷新动作加12px间隔，事件/disabled/角色/unknown逻辑不变。0804126在归档回执后等待草稿读取结束、正文链接出现；截图滚动归零且PNG IHDR高度必须等于文档完整高度。Astra窄审无行为回归/测试放宽。

0804126另给control.ts的私有.cache路径计算加精确turbopackIgnore参数注释。独立审查移除注释后转译的JS逐字节相同；实际最终构建零warning，65trace/12941路径/零私有违规。格式/lint/类型及1162单元重新通过。335PG/46driver对应未改变的持久化/驱动实现，不冒称为布局后再次重跑。最终main部署a4650730871b7957d9b161e73cb9aeba03e5bec1844f81b37cfc960b4770fb46、runtimeBundle 1e8bcf6b707d881c9940733791ea324efdddc04c0ec05c2a5577b8e3069db630，66项连续三轮再次通过且sealed。

最终fresh实例026d155e214ffb9c0a32d2ddb3e8cbc0的全生产Chromium再次222通过/10既有跳过（2.2分钟），24截图实际高度断言通过，两条独立聊天逐张复核全部通过，见P2B3_VISUAL_CHECK。首轮b13ef6543bce2d94dadf9c8b871da6b1与最终实例均在自有Next实际退出后按B3→B2清理成功，随后停止；3100已释放。

0804126的普通CI38744157406实际success；媒体CI38744157653 attempt1和同SHA attempt2均在provision返回MATRIX_STOP_UNCONFIRMED（约31/29秒），原workflow未保留具体子case，不能推定根因或使用本地成功覆盖。新增仅failure()执行的有限诊断读取最多8个UUID目录、两固定summary、512KiB普通文件，投影白名单case/pass/有限code/stopped，不输出路径/nonce/stdout或原报告、不改变验收判据。独审指出crashed-parent-close-budget不在正式matrix列表，已仅加入诊断白名单；实际执行workflow投影的合成检查保留该失败并丢弃私有canary，未改正式MATRIX_CASES。待独立关闭诊断审查并推送获取实际失败明细；本阶段仍未技术验收。

## 技术退出

诊断遗漏P2已独立关闭并提交08ecf57。该head普通CI38745820486（checks/database）与媒体CI38745820485（含真实sealed Next入口）均实际success。080两次媒体失败根因仍未定位，诊断变更不宣称修复运行根因；正式通过/停止判据保持不变。六项检查、335PG/46driver、最终main三轮及24图全部完成，本批技术验收见[P2B3_ACCEPTANCE](P2B3_ACCEPTANCE.md)。后续仅记录/截图交付，不改运行实现；P3-A合同预审已闭合，但尚未开始其代码实现。
