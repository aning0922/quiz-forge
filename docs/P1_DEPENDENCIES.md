# P1 依赖采用记录

2026-10-12，Node 20.20.1 / pnpm 10.32.1。先核实官方 npm 发布元数据和仓库文档，再固定安装。实施后必须用本机与 Linux CI 实际执行验证。许可证不等于维护或安全保证。

| 包                                                              | 固定版本 / 许可                  | 采用方式与边界                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [yauzl](https://github.com/thejoshwolfe/yauzl)                  | 3.4.0 / MIT，Node >=12           | 懒逐条 ZIP 读取；不能代替 CRC、本地头、偏移与消费量核验，项目独立预检并补齐。2026-06 发布元数据。                                                |
| [yazl](https://github.com/thejoshwolfe/yazl)                    | 3.3.1 / MIT                      | 固定参数 addBuffer/STORE 构建，不引入任意压缩包兼容承诺。2024-11 发布元数据，范围小且需独立往返/跨 TZ 验证。                                     |
| [sharp](https://sharp.pixelplumbing.com/install/)               | 0.35.5 / Apache-2.0，Node >=20.9 | 显式直接依赖，不依赖 Next 传递包；静态图片完整解码，macOS arm64 和 Linux CI 都需验证；原生子依赖另有许可，随依赖发行物保留。2026-09 发布元数据。 |
| [buffer-crc32](https://github.com/brianloveswords/buffer-crc32) | 1.0.0 / MIT，Node >=8            | 显式直接依赖，独立 CRC-32 完整性检查，带类型声明。                                                                                               |
| @types/yauzl、@types/yazl                                       | 3.4.0 / 3.3.1，MIT               | 开发时类型，运行行为仍以固定库和测试为准。                                                                                                       |

[yauzl 官方约束](https://github.com/thejoshwolfe/yauzl/blob/master/README.md)说明中央目录随机访问和不核验 CRC，不能把库成功打开当作安全结果。[yazl 实现](https://github.com/thejoshwolfe/yazl/blob/master/index.js)以本地日期字段写 DOS 时间，采用固定本地年月日并跨 TZ 测试。[sharp 安全说明](https://sharp.pixelplumbing.com/security/)要求系统资源控制；P1 子进程超时不等于完整沙箱，后续开放上传前需服务隔离。

不采用 file-type 最新版（Node >=22 不符合当前 Node 20 基线，且 sniff 不代替 decode）；不采用 fontkit 作为安全验证器（parse 不等于字体 sanitizer）。P1 拒绝包内字体，后续受控字体注册另行实施。依赖没有改变模块化单体、Product 所有权或不可执行包边界。
