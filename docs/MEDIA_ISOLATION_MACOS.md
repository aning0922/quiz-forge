# macOS 媒体隔离实验

2026-10-12。本流基于 `6066c3b`，独立 `codex/media-isolation-macos` 工作树；只拥有 `scripts/quizpack-media-preflight/shared/`、`macos/` 和本文。不是 B2-2 接入，未修改 P1/HTTP/Studio/DB，也不启动3100。

共享里程碑：冻结 `LaunchContext` / `LaunchResult` / 有限错误码和限额；预检同步取得私有字节/严格声明快照，保留 P1 bytes/hash/magic/扩展名/PNG-WebP动画/尺寸/像素语义。拒绝共享内存和额外声明字段。未另建解码器；只有固定原 P1 worker 完整解码可产生事实。stdout 解析严格限制 UTF-8、长度、字段、单个原 worker JSON及匹配声明。

共同原生探针 `shared/posix-probe.c` 是可信合成 harness 的闭集工具。只测试文件、线程/fork/posix_spawn、TCP connect/bind/listen、Unix connect和继承文件/套接字 FD；EPERM/EACCES才算拒绝，不把ENOENT/连接失败当成功。Linux特有clone/vfork/seccomp、mac Mach/别名扩展由各流添加。固定结果协议为 `posix-probe.v1`，只含布尔断言，不含errno、路径或哨兵内容；编译产物仅置私有忽略缓存。正常入口不得接收这些可执行/argv。

共享复现：`node --import tsx --test scripts/quizpack-media-preflight/shared/*.test.ts`。原生编译：`cc -std=c11 -Wall -Wextra -Werror -pthread scripts/quizpack-media-preflight/shared/posix-probe.c -o <本次私有缓存>/posix-probe`。实际平台 macOS26.6.2(25G83)/arm64/Node20.20.1/pnpm10.32.1，冻结安装完成；平台权限和停止矩阵尚待实测，不宣称通过。

共享检查实际结果：9项node:test（包括真实C编译/线程/fork/spawn/FD非沙箱对照）通过；定向ESLint与tsc通过。首次C编译发现严格POSIX宏隐藏INADDR_LOOPBACK，改用固定127.0.0.1整数后通过；一次unused变量lint及Next环境类型问题已修正。原生对照只操作自有合成文件，测试结束已删除本次目录。未运行build/E2E/DB/远端CI，共享提交不代表平台矩阵通过。

共享复审补丁：FD探针改为mac libproc当前进程描述符列表 / Linux自身 `/proc/self/fd` 有界枚举（最多65536项）；完整性无法证明或fstat异常时scanComplete=false且安全断言false，不只检查3..255。实际FD300注入自有只读合成文件后明确返回false；无额外FD对照返回true。网络协议每操作返回socket-denied/operation-denied/prerequisite-denied/allowed/failed，前置socket拒绝不虚构connect/bind/listen已执行；listen先bind，bind拒绝时明示未执行listen。语法合法不代表政策通过。worker/probe UTF-8 BOM均明确拒绝。mac共享11项测试/定向lint/tsc/格式检查通过；Linux socket创建拒绝的真实证据由Linux流补齐，不把mac结果当Linux通过。
