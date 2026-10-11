# 测评工作区与资源基础（F1）

## 状态与范围

本文定义 F1 的架构合同和后续实现边界，不代表数据库、后台、ZIP 导入或正式发布已经存在。当前主线已经有历史人物的合成视觉体验、12 题浏览器本机演示、只读 synthetic 结果与真实 PNG 海报导出；这些是研究/演示交付，不是 Product、AccessKey、QuizSession、QuizReport 或已批准商品资源。

F1 只交付可在本地测试的纯 TypeScript 基础：`foundation.v1` 运行时 Schema、`productId` 归属/引用验证、草稿 revision/hash 纯逻辑，以及三结果 synthetic 参考包。它不读取对象存储、不连接 PostgreSQL、不建迁移、不解压 ZIP、不导入 QuizPack、不评分、不创建后台或正式发布。`foundation.v1` 不是 `quizpack.v1`；后者仍按 `QUIZPACK_SPEC.md` 的后续阶段完成。

## 一款测评的工作区

一款测评对应一个 `Product`。Product 是稳定的业务 ID、公开 slug 和归档根；它不是仅用于销售的外壳，也不需要另建 `QuizProject`。一个 Product 的草稿和发布版本可包含：

```text
Product
├─ ProductDraft（可编辑、带 revision/content hash）
│  ├─ Quiz draft：题目、选项、规则、结果原型
│  ├─ Visual draft：页面状态、受控组件、资源槽位
│  ├─ Report draft：基线内容和报告配方
│  └─ staged imports/assets：未验证或待审核输入
└─ ProductVersion v1, v2, …（不可变）
   ├─ QuizVersion snapshot
   ├─ ProductVisualVersion + AssetPackVersion snapshot
   ├─ ReportTemplateVersion snapshot
   └─ Component registration/version snapshot
```

题目、选项、规则、结果、商品私有图片和字体都必须有相同的 `productId`。引用必须同时通过：引用方 Product 与被引用资源/定义的 Product 相同。F1 的跨 Product 引用一律拒绝，不信任输入自报 shared/approved；未来共享资源必须由平台受信注册表和权限单独确认后才能引用。

主题、类目和商品不混用：Theme 是视觉语言；Category 是稳定目录层级；Tag 是多选筛选属性；Collection 是可排序的运营专题；Product 才是测评工作区与版本根。Category/Tag/Collection 的编辑只影响目录投影，不能改写 ProductVersion、题库、会话或历史报告。

## F1 内容合同

`foundation.v1` 的目标是尽早让不可信 JSON 不能冒充内部 TypeScript 对象。最小根对象应包含：

- `schemaVersion: "foundation.v1"`、产品稳定身份及内容版本；草稿封装另带 `productId/draftId/revision/contentHash`；
- 限定的逻辑声明、视觉引用、报告引用和资源引用；
- 所有稳定 ID、引用关系和有限枚举；
- 三个 synthetic 结果样本，仅用于展示/验证引用完整性，不是评分输入或发布内容。

F1 validator 至少拒绝：未知顶级字段、空/重复 stable ID、跨 Product 引用、缺少资源/组件引用、无效版本格式、草稿封装的内容 hash 与 canonical 内容不一致，以及将脚本、HTML、URL 模块、任意 props 或执行字符串放进合同。它不在 F1 验证 ZIP 容器、文件魔数、解压限额、评分可达性、素材商业授权真实性或完整 QuizPack v1；这些仍是后续验证器与人工审核责任。

三结果参考包应使用明显的 `synthetic` 标记、固定 productId、固定资源 ID 和固定展示 DTO。它用于单元测试“结果/资源不会越商品串线”和视觉开发，不得作为正式题库、报告快照、AI 输入或商业素材批准证据。

## 草稿、hash 与发布

草稿保存需要调用者提供 `expectedRevision`。纯逻辑更新要求 revision 相同、JSON 边界合法且满足调用处的 `foundation.v1` 验证；通用草稿函数不授予领域合法性，输出 `revision + 1` 和重新计算的 canonical content hash；不匹配返回显式 conflict，绝不做最后写入者覆盖。hash 是内容身份和验证证据的绑定键，不是安全签名，也不替代用户权限、数据库事务或 revision。

未来真实发布服务必须在同一发布决定中复核：草稿 revision、content hash、验证证据、资源 hash/审批、组件兼容性和人工审核状态。它创建新的不可变 ProductVersion，而不是把 ProductDraft 更新成 published。任何后续编辑都克隆到新 draft；回滚只修改新 Key 的发布指针。

## 资源的逻辑归属与物理存储

资源有三层标识：

1. 业务资源引用：`resourceId`、`productId`、用途（cover/portrait/question/report/poster/font 等）、审批状态和显示元数据。
2. 不可变内容 blob：`contentHash`、真实 media type、bytes、像素/字体元数据和私有 storage key。相同 hash 可以去重，但不会因此获得跨 Product 使用权。
3. 版本化资源包条目：AssetPackVersion 将特定用途固定到一个 blob hash，并记录来源、许可证证据、裁切与审核结果；ProductVersion 固定 AssetPackVersion。

未来文件先进入 `staging/{importId}/...`，完成字节/类型/hash/引用检查后再提升为私有 `assets/sha256/{hash}`。不要使用可覆盖公共路径作为历史版本引用。浏览器只获取已批准衍生物或经授权的短期 URL；原包、staging 和未批准素材不能放到 `public/`。

对象存储写入和数据库写入没有跨系统原子事务。实现时必须保存 staging/archiving/ready/failed 状态，采用可重试的提升操作，并在失败后删除或标记孤儿对象；发布前再次检查 blob 存在和 hash 一致。资源只有在数据库记录、物理对象和批准状态全部成立时可被 ProductVersion 引用。

## 后续最小服务端与 DTO 边界

以下仅列跨阶段能力关系；实施前置是 P1 包工具，阶段顺序以 ROADMAP_30D 为准，正式发布闭环在 P5 验收：

1. PostgreSQL/Drizzle 迁移：Product、ProductDraft、版本化内容、Asset、运营身份。
2. Studio：一个管理员、商品草稿编辑、revision conflict、资源 staging 与预览。
3. 发布：验证证据和资源审批齐全后创建 immutable ProductVersion。
4. 消费者：AccessKey 摘要、固定版本、QuizSession revision、确定性完成事务和只读 QuizReport。

公开 Catalog DTO 仅含发布商品介绍；Studio DTO 含 draft ID/revision 且只能由运营身份修改；Play DTO 仅暴露当前固定版本允许看到的题目/选项和进度；Report/Poster/Share DTO 从锁定快照投影，逐层脱敏。浏览器不得提交 score、结果身份、版本选择或资源 URL 并要求服务器相信它们。

正式完成的事务仍遵循既有原则：锁定有效 Key/Session，若已存在 report 则幂等返回；验证完整答案与固定版本；服务端评分；插入唯一的 `QuizReport(access_key_id)`，再将 Session/Key 标为完成。F1 不实现这条事务，也不允许本机 `localStorage` 演示获得完成权威。

## F1 验收与后续迁移

F1 单元测试至少覆盖至少两个 Product 的隔离用例及一个三结果 synthetic 参考包、同 Product 合法引用、跨 Product 拒绝、未知资源/未声明布局引用拒绝（组件是否真实存在留待注册表阶段）、重复 ID 拒绝、hash 改变与 revision conflict。测试数据必须是合成数据，不能写真实 Key、用户结果或商业资源。

F1 完成后运行的检查只证明新增纯逻辑合同；历史主线的 39 unit、186 E2E、10 skip 不自动覆盖新代码。数据库阶段要新增隔离 PostgreSQL 集成测试：迁移可重复、发布不可变、资源提升补偿、session revision、Key 完成唯一约束和旧版本读取。真正的 ZIP 安全、导入、后台权限、评分、AI 和生产发布分别保留给后续已授权阶段。
