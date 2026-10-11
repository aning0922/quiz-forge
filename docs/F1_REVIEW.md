# F1 独立审查

## 审查状态

2026-10-11（Asia/Shanghai）。A 与 B 最终交付代码及最后修复已完成本轮独立审查，未发现未解决的 P1/P2。F1-R1、F1-R3 均已修复并独立复测关闭；F1-R2 的 no-op 语义已明确，代码、测试与共享文档一致。此结论只覆盖本次独立审查，不替代总控完整工程检查、远端 CI、人工批准或发布资格。

- 正式 origin：`https://github.com/aning0922/quiz-forge.git`。
- 总控检出：`codex/assessment-resource-foundation`。
- A 原提交：`2a55ca322017f9222a074b8ffe32352ad6fdf871`。
- 总控集成提交：`9249966`；A 的五个交付文件与原提交无差异。
- B 草稿/JSON 原提交：`f78e4cd411388a1c0f8b82137ed302238e7f3f9f`；审查时总控 HEAD 为 `95cc64fbfe618c0f452481e442796b48da4c0b00`。
- B 最终 CLI/边界提交：`f4b0f00b06927883b20f13651a9940dfc0419c2d`；最终审查总控 HEAD 为 `f6089eef92ed0e20a4756ca9a4cfac99930e24b5`，B 实现/测试与原提交无差异。
- B 入口修复提交：`38bf2a8f55798a75344db0dca44d0f9a0335341a`，集成为 `946f03f292440d24bea7ee1eaeac2239480bce77`；该提交仅修改 draft.README 和 CLI 测试，两文件与原提交无差异。共享合同的 no-op/--silent 同步已在总控工作区读取确认，尚由总控统一提交。
- 前置合同修订：`afdd0ac`；依赖基线：`3165e42`。
- 审查仅写本文，不修改实现、依赖、其他文档，不启动服务器或提交。总控六项检查及 CI 由总控独立记录。

## 前置决定

Product 是唯一测评工作区。F1 跨 Product 资源一律拒绝，不信任包内共享或批准声明；可信共享资源留待后续阶段。内容载荷与草稿封装分离，F1 仅实现可编辑草稿的纯逻辑，不提供审核或发布状态迁移。证据身份匹配不是可信审批。

调用方必须以草稿封装 productId 调用领域 validator，再创建或更新领域草稿；通用草稿函数成功不构成领域有效性。CLI 使用显式 --product 作为外部目标，并已有目标 A/内容 B 拒绝测试；草稿调用顺序已在开发说明明确，当前不新增应用服务或保存入口。

总控后续明确：省略 content 或 canonical 内容相同的调用是 no-op，返回独立深拷贝，revision/hash 不变，旧证据保持匹配；只有内容改变才 revision++ 并使旧证据失效。最终代码按此验收。

## A 审查范围与结论

审阅 `foundation.ts`、`foundation.test.ts`、`foundation.md`、`historical.foundation.json` 和 `resource-contract.ts`。

1. 结构采用 strict Zod 对象，从同一合同推导 TypeScript 与 JSON Schema；文本、集合、数字、ID、版本和路径均有限制。未知根/嵌套字段被拒绝，错误采用固定消息，不回显 Zod 原始消息或未知字段内容。
2. validator 使用调用方 targetProductId；定义和引用检查 Product 归属，资源不接受共享例外。内容定义固定 contentVersion；资源有独立版本，引用须精确匹配资源声明版本。自报 approved 不改变 publishable。
3. ID 在明确命名空间内唯一；选项 ID 跨题唯一。题/选项/维度/结果/资源/模板/组件引用均检查，见证要求每题恰好一个归属正确的选项；不声称见证经过评分执行。
4. 路径白名单拒绝 traversal、绝对路径、反斜线、URL、未知扩展和大小写别名；清单路径重复及扩展/媒体声明冲突被拒绝。没有将清单检查描述为 ZIP 或文件字节验证。
5. 成功及失败结果均保持 publishable=false，并返回 ZIP、文件字节/媒体/hash、评分可达性、注册表兼容、许可声明、人工审核和数据库/权限/发布未验证项。
6. 参考包为两个合成题、三个合成结果、完整基线槽位、六状态布局引用与完整声明见证。四项资源均为 pending/unverified，占位零 hash 和一字节声明明确不是文件核验结果。未接入消费者路由或 PNG 导出。

## 独立验证证据

- 执行 `pnpm exec vitest run src/features/quizpack/foundation.test.ts`：1 个文件、72 项测试通过，退出码 0。
- 只读 stdin 探针验证 ID/版本尾部换行拒绝；构造全包替换后的身份/版本仍被结构校验拒绝。
- 对照导出 Schema 与 Zod 的 13 组输入：合法参考包、根/嵌套未知字段、1001/2001 个非 BMP 字符、ID/版本尾部换行、HTML、空白、NUL、缺 resume、非整数 bytes、超量资源。两侧结果全部一致。
- 对照使用仓库已有的 Ajv 6.15.0，对克隆 Schema 移除 `$schema` 元标识后验证双方支持的结构关键字；未安装或修改依赖。这是结构关键字的一致性探针，不是完整 Draft 2020-12 实现兼容认证。原导出 Draft 2020-12 标识、strict 对象及有限容器另由现有单测核实。
- 审查没有运行 build、E2E、浏览器截图或远端 CI，不能把上述单测和探针当作整体验收或视觉通过。

## B 草稿与 JSON 审查

审阅 `draft.ts`、`draft.test.ts`、`draft.README.md`、`foundation-json.ts` 和 `foundation-json.test.ts`。执行 `pnpm exec vitest run src/features/product/draft.test.ts src/lib/foundation-json.test.ts`：2 个文件、48 项测试通过，退出码 0。

解析器在原生 JSON.parse 丢失重复键信息前按解码后的键拒绝重复及原型污染键；流输入限制原始字节，fatal UTF-8 解码，容器深度限 32。canonical JSON 使用固定排序、有限数字和普通数据描述符，拒绝 getter、Proxy、稀疏数组、额外数组属性及循环；克隆打断调用方嵌套别名。证据匹配复核现存内容 hash，并同时比较四个绑定字段。补充探针确认 Proxy 在零次 trap 调用下拒绝，共享子对象被克隆成独立值，Unicode 转义重复键/污染键拒绝。

### F1-R1 — P2，已关闭：旧提交创建成功的近上限草稿无法再次使用

旧提交 `f78e4cd` 位置：`src/features/product/draft.ts:77`、`:81`，共同原因位于 `record()` 第 42 行与 `verifiedDraft()` 第 52 行。以下为历史复现，最终代码已修复。

`createProductDraft` 只对创建请求整体执行 1 MiB 限制，随后新增 revision/contentHash 返回更大的封装；`verifiedDraft` 又按同一个 1 MiB 限制克隆完整草稿。因此成功创建不保证返回值能通过该模块自己的后续操作。

可复现输入（仅合成字符；从仓库根用 tsx 执行）：

```ts
const request = {
  productId: "p",
  draftId: "d",
  content: "x".repeat(1024 * 1024 - 60),
};
const draft = createProductDraft(request);
createDraftEvidenceBinding(draft); // JSON_SIZE_LIMIT
updateProductDraft(draft, {
  productId: "p",
  draftId: "d",
  expectedRevision: 1,
  content: null,
}); // JSON_SIZE_LIMIT，甚至无法缩小内容
```

实测创建请求 1,048,560 bytes，小于 1,048,576；返回草稿 1,048,654 bytes。创建成功后两个操作均失败。建议统一内容与封装的预算策略，或在返回前拒绝不能往返的最终封装；同样检查更新增加 revision/hash 元数据后的返回值。加入边界成功往返及明确拒绝测试，不能只测独立 JSON 工具的上限。

最终 `f4b0f00` 已独立修复：record 按安全数据描述符提取字段，content 独立享有 1 MiB / 32 层预算，封装元数据不占内容预算；新增满上限内容的证据/no-op/缩小更新测试。独立重跑上述原复现：证据匹配为 true，更新为 null 后 revision=2，未再抛出 JSON_SIZE_LIMIT。本项仅针对旧提交，不是最终代码的未解决缺陷。

### F1-R2 — 已关闭：相同内容更新的 no-op 合同差异

位置：`src/features/product/draft.ts:90`、`:120`，及 `draft.test.ts` 的 no-op 测试。

实现把省略 content、canonical 内容相同均定义为 no-op，保留 revision/hash/证据；开发说明与测试一致。初审时 `FOUNDATION_F1.md` 第 10 行和 `ASSESSMENT_RESOURCES.md` 第 46 行要求成功更新产生新 revision，未声明这个例外。实测 `{a:1,b:2}` 更新成 `{b:2,a:1}` 后 revision 仍为 1，旧证据仍匹配。

这不是发布或审批绕过。总控已明确采用 no-op 保留绑定语义，最终代码及测试符合决定；共享 `FOUNDATION_F1.md`、`ASSESSMENT_RESOURCES.md`、`F1_COLLABORATION.md` 已明确“实际内容变化才递增，no-op 返回独立副本并保持证据”。最终复核读取确认，本项关闭。

## 最终 CLI 与组合验证

审阅三个 scripts/foundation 脚本及最终 B 变更。在 `f6089ee` 独立执行 `pnpm exec vitest run src/features/product/draft.test.ts src/lib/foundation-json.test.ts src/lib/foundation-json-cli.test.ts`：3 个文件、71 项测试通过，退出码 0。入口修复后在 `946f03f` 重跑 `pnpm exec vitest run src/lib/foundation-json-cli.test.ts`：24 项测试通过，退出码 0。新增 3 项测试覆盖实际 pnpm 入口，未改前述运行时实现；结合 A 的 72 项及未变的 B 非 CLI 测试，独立精准执行覆盖最终新增 146 项，没有据此冒充全仓库或六项检查。

脚本层文件/stdin/错误退出/无正文回显、重复键、非法 UTF-8、BOM、大小/深度边界均有子进程测试。超量 stdin 即使写方不关闭也退出；Schema 来自 A 的实际导出。外部 --product 与内容不符被拒绝；合法结构/引用仍 publishable=false，未验证事项保持明确。

### F1-R3 — P2，已关闭：文档命令的 pnpm 横幅破坏 JSON 输出并回显路径

初审位置：`docs/F1_COLLABORATION.md:27`、`src/features/product/draft.README.md:24`；当时测试缺口位于 `src/lib/foundation-json-cli.test.ts:22`，直接调用 node/tsx，未经过文档规定的 pnpm script 入口。

独立使用 spawnSync 运行以下真实命令，捕获 stdout/stderr：

```sh
pnpm foundation:check src/features/quizpack/fixtures/historical.foundation.json --product historical-synthetic
pnpm foundation:check
pnpm foundation:schema
```

三项 stdout 均在 JSON 前包含 pnpm 的包名/脚本横幅和仓库绝对路径，JSON.parse(stdout) 均失败；退出码分别 0、1、0。因此导出 schema 重定向文件会得到无效 JSON，且文档承诺的“无绝对本机路径”不成立。底层脚本脱敏测试通过不能证明包装命令符合合同。

修正将机器接口用法统一为 `pnpm --silent foundation:check ...` / `pnpm --silent foundation:schema`（或 corepack 等价写法），并对实际文档命令增加子进程验证。未改全局或项目 pnpm 日志配置。最终复核确认 README、共享合同和 draft.README 均使用 --silent。

已独立实测同样三项加入 --silent 后：stdout 全部可 JSON.parse、不含 cwd、stderr 均空，退出码仍分别 0、1、0。最终 `38bf2a8` 增加实际 pnpm script 子进程的合法输入、非法输入与 Schema 三项持久测试，解析完整 stdout 并断言无横幅、路径和生命周期日志；24 项 CLI 测试独立重跑通过。本项关闭。

## 总控验证状态（明确区分来源）

总控报告：独占 3100 的生产 E2E 已结束，186 passed、10 项既有跳过，58.7 秒，进程退出 0。此次最后修复只涉及文档与测试、无 UI 变化；审查聊天没有另起服务器、重跑浏览器矩阵或据此声称人工视觉通过。

总控此前报告 lint/typecheck/182 项单测/build 成功；最后修复后的 format/lint/typecheck/全量单测复验在本次审查结束时仍由总控收口，最终数量与结果以总控记录为准。审查聊天没有核验远端 CI，不声明 CI 通过。

## 退出条件

独立审查已完成，无剩余 P1/P2，停止审查工作。总控继续完成最终工程检查与证据、实际 CI、提交推送及 Draft PR，之后停止供人工阶段审查；不自动推进后续阶段。ZIP/DB/评分/后台/授权真实性/商业发布仍未实现。
