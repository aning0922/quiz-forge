# P3-C 六状态内部预览

固定页面为 `/studio/products/[productId]/drafts/[draftId]/revisions/[revision]/preview`。路由只做运营身份/参数检查与组合，客户端用共享 URL helper 读取严格 DTO。旧修订原文页增加此固定 scope 的入口，保留原文读取；不读取 current 指针，不把不支持的旧版本换成新版本。

六个编译组件位于 `features/theme/preview/components.tsx`：folio cover/question/resume/report/poster 与 cabinet result。题目按完整 Ref 查 frame，再由 sectionId 查厅和 sceneOverride；无固定题数、按题号猜分厅、指定人物、合成分数、研究 fixture 或 public portrait resolver。原内容长文本完整换行，完整 baseline 与 1–16 维都保留。待审素材有可见标记，缺图显示真实失败，可手动重试。

第三轮真实生产 E2E 的 20 张截图中，题页四宽均出现图片底部待审标签与负边距题厅说明重叠。修复将图片/标签与题厅说明置于上下独立流区，桌面也不再绝对覆盖；图片透明度只作用于图像，标签保持可读。resume 的选择状态和 result 的短声明保持词组完整换行，不缩字号或改文案。E2E 增加四宽 badge/caption 实际边界断言；修复后的截图与 PNG 仍须主控重新构建后实测。

`PreviewFlow` 只保存当前页面内存中的答案。每次编辑、取消或被新请求取代都推进代次；送出的答案数组/元素与固定源副本冻结。接受揭晓须同时匹配原 ticket、代次、完整 binding、requestId 和未变答案快照。答案编辑立刻清空揭晓/报告/海报与 PNG；AbortController 只用于减少工作，不承担迟到响应的权威。题目可在评分等待期间编辑。refresh 创建新内存态，不接 D1 localStorage 或正式会话/报告。

每次图片加载只针对当前状态必要的 Asset，完整有界读完并核 bytes/SHA 后才创建 Blob URL，decode 后再核自然尺寸。切状态、代次变化、卸载和失败都会撤销旧 URL；迟到任务只释放自己的 URL，不替换当前图片。每次资源请求均走 A 的受保护接口，不走 Next 公共图片优化。401/撤权/来源不符使当前揭晓失效，不能承诺远程撤回已下载字节。

PNG 由 `features/report/preview` 独立实现。严格 Export DTO 保留实际选中结果和答案 hash 等身份用于本次内存关联，PNG 仅绘制选中人物/文案/完整维度/包内 disclosure 和固定内部标识，不写 cookie、Key 或私有 URL。受控字体及 coverage 字节逐次核 SHA；使用唯一 FontFace family，实际字符缺失或加载失败阻止导出。文字完整排在 x90..990/y1220..1868 的独立浅色承托区，人物图不承担文字对比度。实际 measureText、墨迹边界、行数与编码任一失败均无下载成功状态，不截断、缩字或挑选维度。原始人物图完整 contain 在上方展示区。

纯单测覆盖实际双引擎投影，以及答案请求代次、完整传输预算、图像截断/额外字节/hash/尺寸/取消、真实字体文件与覆盖表、缺字/迟到字体、完整排版与迟到 canvas 编码。canvas mock 单测不构成真实 PNG 或视觉验收。

`tests/e2e/studio-preview.spec.ts` 使用主控传入的 `QF_PREVIEW_E2E_RUN_ID`，调用 A 的 prepare；从 0600/同 uid/单链接/有界且身份稳定的私有文件读取合成 fixture，凭证不输出、不录 trace。仅全部通过后 finish。root 持有受管 Next 进程并证明真实退出后才能执行清理；本 spec 无 cleanup 权限。E2E 场景定义了两种真实引擎 witness、六状态四宽截图、真实 PNG 和失败路径；是否实际通过由主控执行结果记录，不能用本文件替代。

本线未启动 DB、3100 或 native 媒体；生产构建、真实 E2E、截图像素检查与远端 CI 由主控集成后执行。新固定 UI 的字体缺字已向主控报告；真实首款四图尚未接入本合成 fixture，实际 PNG 四图与文案、素材权利、发布批准仍待后续人工检查。
