# P3-C 固定投影与受控组件

基线为冻结共享提交 `c3fdd8c`。M1 提供静态投影能力登记与真实 server-only 投影；后续 UI 里程碑增加 `components.tsx` 中的六个编译组件与 `PREVIEW_VIEW_REGISTRY`。该 registry 将 M1 的 schema/engine/state/精确版本登记与固定 React 组件表关联，不从内容加载源代码、CSS、模块路径或 HTML。共享 product/preview 合同、字体文件和原研究路由未修改。

## A 的实际接入接口

从 `@/features/theme/preview/projection` 导入：

- `preparePreviewContent(content, binding)` 沿冻结 `PreparePreviewContent` 返回 `{ok:true,value:{entry,prepared}}` 或有限失败。HTTP 只发送 `entry`，不发送整个准备结果。
- `scorePreview(prepared, answers, requestId)` 沿冻结 `ScorePreview` 返回真实 `PreviewReveal` 或有限失败。prepared 只在当前服务端调用中持有，不是身份、权限、持久化记录或跨请求授权缓存。

prepared 是无输入/Map 别名的冻结对象，只有私有 WeakMap 中的原对象能执行；复制、JSON、Map 和 Proxy 不能代替，意外 JSON 序列化原 handle 也明确抛出固定错误。入口和揭晓 DTO 经严格共享 Schema 重新解析并深冻结，与原 content/binding 无可写别名。

## 固定来源及实际执行

先有界普通快照 binding 和完整 content，拒绝 getter、Proxy、异常原型、非法 Unicode、v1/未知版本、错误六状态三元组和未知 props。完整 canonical content SHA 必须等于 binding；assetSet SHA 从严格资源声明按已归档 asset-set.v1 的 id/version 顺序和 canonical declaration SHA 推导并匹配，包含 approval/source/license 等声明变化。此处不声称物理 blob 已读取或授权，真实 revision/asset-set/目录/字节核验仍由 A 的服务完成。

真实调用 `prepareContentForScoring`，保留其完整引用和逻辑边界；不使用客户端分数、结果、reportTemplateRef，也不在请求中跑见证或覆盖扫描。评分仅从该私有快照的实际 `scorePreparedContent` 决策选择精确卡片、report baseline 和 portrait；再核 content/version/Product/engine/report 引用。维度按原内容顺序使用现有 `displayHalfUp`，含真正有理数的半入一位小数，不传 rawSum、normalizedAnswers、所有距离或候选结果。

入口只投影三种预揭晓 Layout、完整有序题目/选项显示字段、sections/frames 及 cover/scene 的精确中性资源并集；包括逐题 override，但无人物元数据。揭晓只包含实际选中的 portrait、完整 baseline 和真实维度，不增加年代、文化史实、维度解读或短标签。

海报候选数据严格沿共享 `previewPosterSchema`：完整 1–4 维、码点和显式行数全部符合时才是 `ready`；否则仅 poster 返回 `unavailable/POSTER_LIMIT_EXCEEDED`，不截取前四维、不修改文案，不使真实评分或完整报告失效。`ready` 只表示 DTO 达到候选约束；实际导出仍须通过 `features/report/preview` 的字体、图片、measureText、画布边界和 PNG 编码检查。

## 预算、失败与证据

完整 `{ok:true,value}` 成功封套先按实际 UTF-8 JSON 字节预算衡量，再严格解析/发布：入口 524,288 B、揭晓 262,144 B。超限只返回 `PREVIEW_LIMIT_EXCEEDED`，不删字段、不截断。新入口不放宽原包预算。

binding/source/ref 不符返回 `PREVIEW_BINDING_MISMATCH`；不支持的内容/registry/Unicode 返回 `PREVIEW_UNSUPPORTED`；答案结构、完整性、归属或 requestId 不合法返回 `PREVIEW_INVALID_ANSWERS`；结构/字节上限返回 `PREVIEW_LIMIT_EXCEEDED`。不回显原文、未知异常或路径。

本里程碑纯测试涵盖双引擎逐卡真实计算、authored/synthetic 元数据、完整 baseline/选中卡隔离、原始别名和私有 handle、全部绑定、跨版本/乱序/错用途/registry、完整维度及海报单独失败、UTF-8/转义完整封套精确边界与 +1。测试夹具明确是合成声明，不构造正式素材/许可或批准；没有启动 DB、3100、native 媒体或真实浏览器。
