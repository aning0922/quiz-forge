# F1 本地草稿纯逻辑

`draft.ts` 只封装有限普通 JSON，固定 `productId` 和 `draftId`，计算 canonical JSON 的 SHA-256 内容身份。它不判断测评领域合法性，不连接数据库，也不执行审核或发布。

内容独立受 1 MiB / 32 层限制，草稿封装元数据不占内容预算。创建初始 `revision = 1`。更新必须携带相同身份和 `expectedRevision`；冲突、非法安全整数、hash 与现有内容不一致、未知封装字段均拒绝。内容替换后 revision 加一，hash 只取决于内容，不包含 revision 或时间。达到 `Number.MAX_SAFE_INTEGER` 后拒绝实际内容更新。

省略 `content` 或提供 canonical 内容相同的更新，是明确的 no-op：返回深拷贝，保留 revision/hash 和证据匹配。实际内容变化返回新 revision/hash，使旧审核绑定失效。输入、旧草稿、输出与替换内容之间没有嵌套别名。返回值可被调用方修改，但下一次操作会重新校验内容 hash；它不是不可篡改对象或可信持久化状态。

`createDraftEvidenceBinding` 和 `matchesDraftEvidence` 同时绑定 product/draft/revision/hash，只表示本地证据是否仍匹配，不产生批准记录或发布权威。调用方必须先以**外层可信 productId** 校验领域内容，不能从包中自动接受商品身份：

```ts
const checked = validateFoundationBundle(content, productId);
if (!checked.structurallyValid || !checked.referenceValid) {
  // 拒绝领域无效内容；F1 所有结果仍为 publishable:false。
  throw new Error("Foundation content rejected.");
}
const draft = createProductDraft({ productId, draftId, content });
```

该调用方式是未来应用服务的边界说明，不是已实现的保存/发布入口。更新也必须在调用纯函数前，以草稿外层 productId 调用领域校验器。

JSON 工具位于 `src/lib/foundation-json.ts`：最多 1 MiB UTF-8 和 32 层容器，拒绝重复解码对象键、原型污染键、非有限数值、非普通对象、访问器、稀疏数组与环。canonical 序列按对象键的 UTF-16 字典顺序排序，保留数组顺序；不对 Unicode 文本做等价归一化。`-0` 按 JSON 规范化为 `0`。

CLI 已接入 A 的实际领域 validator。使用 `pnpm --silent foundation:check <file> --product <id>` 或 `pnpm --silent foundation:check - --product <id>`；`--silent` 用于抑制 pnpm 横幅、工作目录及生命周期日志，确保 stdout 是纯 JSON。输入按字节流有界读取，错误返回 JSON 并非零退出，不回显源文、堆栈或本机路径。合法结构与引用退出 0，仍固定 `publishable:false`，不验证 ZIP、文件字节、评分、注册表或真实人工审批。`pnpm --silent foundation:schema` 输出结构 Schema，跨引用仍必须另过领域 validator。
