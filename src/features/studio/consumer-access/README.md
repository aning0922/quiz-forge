# P4 Studio play / Key 操作客户端

当前已建立客户端严格事实验证、本标签原请求/秘密保管、Studio 页面及可注入的 HTTP 适配。真实业务 service factory 与 API 路由尚未接线；不声称实际 Key 发放成功。

client.ts使用冻结operation DTO、完整binding resolution与独立Studio x-csrf-token，不借用消费者CSRF。create返回201/200与created必须一致；详情/列表核Product、精确ID与所有receipt hash。Key页游标仅使用issuedAt/keyId严格一对，并核Product；原binding总量有界。play详情封套预算为snapshot上限+receipt上限，不扩大两者内部机器限制。

pending.ts在运营浏览器CSPRNG生成32字节raw，按独立access-key域求digest，准备后完整持久化/回读并核raw→digest，markBeforeSend再次完整回读后才允许POST。scope固定origin/instanceId/issuerId/productId，sessionStorage隐含本标签；不承诺跨标签唯一保管或XSS隔离。相同bucket不能覆盖未核请求，异步回读期间current失效拒绝标发送/删除。raw=null表示已知原文丢失，保留原binding供只读核对，拒绝发放/重放；不能用metadata重建私密链接。只有严格终态证据和用户显式确认后，调用方才可精确删除。Cookie、Studio/consumer CSRF、grant不入该记录。

8项合成测试覆盖raw/digest、严格独立CSRF与API零raw、正确create状态和原binding、坏Product/cursor、bucket隔离、原文丢失、坏存储/回读/摘要、失权与替换保护。typecheck和定向lint通过。实际controller/复制下载前新鲜issuer核验、Studio路由与生产E2E仍待后续接入，不能把测试fixture当真实服务。

公共共享3ff3d1d已正常merge至本支9dcef7a，冲突仅治理/阶段文档和root独占registry，均使用主控版本，原Studio客户端成果35cc40f保留。当前精确consumer entry为193b48c92352d731c9c2e41de05316471a2c46f58d8e2f2596995ee531d974a1；未创建真实play/Key。

controller.ts已建立整页代次与单一原请求所有权，公开snapshot只含hasRaw等安全摘要，不含raw或访问链接。refresh/失权同步使旧task失效；prepare→完整回读→mark/readback→POST，UNKNOWN不开放第二次新发放，resolve/replay沿原binding。显式终态finish才清本地锚点，不改变服务器结果。复制/下载只在已核applied、原raw仍在时执行：先新鲜同issuer/operator会话，读精确当前Key（核原issue/issuedBy、无void、未过期或已完成），完整回读同秘密锚点，再次新鲜issuer确认后才把fragment链接交给显式expose回调；回调后仍核代次才能显示成功。

控制器6项合成测试通过：零API raw/公开snapshot raw、复制前新鲜身份、UNKNOWN原样保留/重放、不同issuer/只读降权、坏本地保存零POST、失权迟到成功、原文丢失仅可resolve。所有网络client/pending/controller目前共14项通过，typecheck与定向lint通过。StudioUI/真实HTTP业务factory与生产闭环仍待接入；这些不是实际发放或权限事务验收。

父版本读取隔离：新readStudioParentVersionsV1直接读取同一冻结internalVersionListResponse DTO并核Product，使用本轮有界JSON transport；不再由controller默认导入旧draft response链中的Node模块。旧接口401/403按当前授权丢失处理且回调一次，旧协议/代码未改。新增用例后client4项+controller6项通过；独立浏览器打包已不再出现node:util依赖。UI行为与截图仍在验证，尚不记为浏览器通过。

secret披露P2整改：最后一次新鲜issuer await后，立刻用同步完整规范记录比较核原scope/原binding/原raw/sent标记；无新的异步回读窗口。传入copy/download回调的current也持续结合相同原锚点与epoch，显示copied/exported前再核一次。存储缺失、原文丢失、合法替换、存储异常均failclosed，撤去旧证据展示，不清新锚点，不将raw放公开snapshot。

两组回归共8种mutation在最终auth等待、callback等待两个窗口分别验证；旧生产实现负对照两组均失败（旧披露1次、旧callback current=true）。修后controller8+pending5共13项通过，lint/typecheck通过。原独审3个JSON、负对照与修后测试日志保留.cache/p4-review/studio-*-original.json、studio-disclosure-negative-control.log/after.log，仅合成，无真实剪贴板/文件写入或真实Key。此修补独立于尚未提交的Studio UI/HTTP。

`http.ts` 在构造单一 request owner 前核 source、方法、查询、Studio Cookie/CSRF、路由与完整 binding；服务按操作懒构造，同一原始 15 秒时钟贯穿解析/执行/关闭。严格校验每份 receipt、完整 resolution 与列表范围，写成功后响应或实际关闭失败返回 UNKNOWN，读请求不制造写成功。finally 只关闭原 owner；没有数据库构造或替代业务实现。5 项合成单测通过，定向 lint 与 typecheck 通过；这不证明实际运营权限、PG 事务或生产路由通过。

Studio 页面位于 `/studio/products/[productId]/consumer-access`，工作区新增入口；Server Component 只传固定 renderer 与 origin/instance/issuer/product 范围，不传原文、Cookie 或 CSRF。页面提供具体父版本/内测版本选择、发放期限、安全 Key 元数据、原请求核对/重放、显式终态清除、复制/下载与未领取作废。只读身份不展示写入/披露控件，UNKNOWN 不开放第二次新请求；raw 丢失只允许核对。复制/下载紧邻实际副作用调用 current，文件下载仅表示已触发，提示用户确认保存。离开链接/pagehide/卸载同步失效；登录尝试/退出先发布无任何身份或凭证载荷的同标签与 BroadcastChannel 失效通知，接收端撤销旧代次。每次敏感操作仍独立做服务器新鲜身份核验；广播不是授权依据，也不保证操作系统已接收的副作用可撤回。

`pnpm exec tsx tests/browser/studio-consumer.ts` 使用临时独占随机端口、合成内存 HTTP 与实际 React 页面；无数据库/实际权限/3100/系统剪贴板。Chromium 156.0.8078.4，320/375/390/430 × 900 CSS px，15 张完整截图及全部原尺寸分段已复核：创建、发放、UNKNOWN 刷新不自动写入/原请求恢复、同标签失效中断等待披露、跨标签失效、导航阻断旧披露、issuer 变化、只读、claim 先于 void、未领取成功作废。断言无横溢出、无 raw DOM、交互目标 ≥44 px；隔离 Clipboard stub 只返回次数/安全布尔值，真实浏览器下载写入 0700 私有缓存目录中的 0600 合成文件，只比对摘要。证据在 `.cache/p4-studio-consumer/1792343762968`，13 图原尺寸复核在 `1792343519257/qa-bands`，新增两失效图直接原尺寸复核；未发现阻断布局。这不替代作者视觉验收，也不是实际 DB/生产 E2E 通过。真实 factory/API 路由与正式生产闭环仍待后续接线。

80126b7 独审补充 P2：pagehide 不覆盖后台隐藏。页面现订阅 document.visibilitychange，hidden 时同步 revoke，卸载移除订阅；重新 visible 不自动 refresh、重放或续接旧披露。实际页面的 held-auth → hidden → visible 回归中，等待披露被撤销、Clipboard stub 调用数不增加、旧成功提示不出现，原锚点保留供显式核对；修后完整 harness 16 图通过（`.cache/p4-studio-consumer/1792344045938`，新增失效图已原尺寸复核）。使用 80126b7 的原页面跑同一新 harness 为失败负对照，不能显示已撤销身份；日志保留 `.cache/p4-review/studio-hidden-negative-control.log`。定向 lint 与 typecheck 通过；hidden 事件为 Chromium 内合成事件，这不是操作系统标签调度或系统剪贴板验收。
