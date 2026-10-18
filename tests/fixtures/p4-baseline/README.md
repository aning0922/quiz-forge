# P4 独立合成基线

仅用于 purpose=test/ci 的 `consumer-flow-fixture`，不含 demo、作者内容批准、商业权利或发布资格。此产品与 P3-E 的 `internal-version-fixture` 分开，供 P4 自有 r1/head 父版本、真实私有像素读取及端到端事务 fixture 使用；目录本身没有创建数据库或落账任何业务记录。

派生算法在 `tests/support/p4-baseline-definition.ts`，只读旧固定合成输入，递归替换独立 Product 引用，重新规范化 content、asset-set 与 manifest、逐资源 declaration SHA、逻辑与评分见证。五张48×48 PNG保留原合成字节，没有重新编码或替代正式商品角色。两次独立 Node 派生逐文件及 descriptor 摘要完全一致后才写入本目录；旧输入与登记没有改变。

规范 JSON 没有尾随换行；精确三 hash 和测试资格见 `synthetic-evidence.json`。该证据只证明合成定义/图片字节/实际纯评分见证，不冒充原生媒体验证、真实导入审核或首款39eb的批准。应用只静态登记固定 descriptor，不从此目录动态加载代码或增加登记。后续 prepare/finish/cleanup 仍须拥有自己的 actor、import/validation、parent、consumer 子图及物理文件 manifest，先证明未知资源和 server 已停止，再做首次删除。
