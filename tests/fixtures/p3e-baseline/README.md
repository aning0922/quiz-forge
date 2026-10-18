# P3-E 固定合成基线

仅用于purpose=test/ci的内部审核/版本协议测试，没有作者真实批准或发布资格。Product为internal-version-fixture；每次隔离实例中的actor/import/validation/key/receipt仍必须fresh且精确归属。

这些规范JSON和五张48×48 PNG是固定测试输入，保留原字节（无JSON尾随换行），避免不同平台的图片编码器重新生成不同摘要。原recipe为prepareP3dSource固定Product、ordinal1及p3e-fixed-baseline-v1种子；两独立Node进程已核同字节。证据见synthetic-evidence.json。asset-set.json是测试旁证，不是QuizPack文件成员；归档成员为manifest.json/content.json及五图片。

此目录不在Next模块图中，也不提供运行时动态登记；应用仅包含受信registry的固定摘要元数据。后续夹具必须核输入SHA后生成自己的来源事实，不能把本合成证据冒作真实ZIP或原生媒体验证。
