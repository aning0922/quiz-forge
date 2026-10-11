# P2-A 依赖与运行环境

2026-10-12核验。复用固定Next16.4.0、Drizzle0.45.4、postgres3.4.9和Node20.20.1内置crypto，不添加认证框架/JWT/密码库。凭证仅256bit随机值，不能推广为人类密码存储方案。

新增server-only@0.0.1，MIT；npm固定integrity sha512-qepMx2JxAa5jjfzxG79yPPq+8BuFToHd1hm7kI+Z4zAq1ftQiP7HcxMhDDItrbtwVeLg/cY2JnKnrcFkmiswNA==。它是[Next官方建议的服务端边界标记](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning)，不是认证或沙箱。Next自行处理该标记；CLI测试需显式react-server条件或测试专用别名，禁止为了测试删除生产边界。

本机只使用已有Homebrew PostgreSQL18.4二进制初始化新隔离集群，不修改/启动现有服务。CI采用Docker官方library/postgres:18.4，经Registry API核实OCI index digest为sha256:a02db8cac496f15b094798a38254f14d6e00741f709360e5e00bb6668ea31636，包含linux/amd64与arm64。实现时固定完整digest，不只跟随可变tag。许可证依据官方PostgreSQL发行内容与镜像组件各自许可证，不把镜像整体误称单一应用许可证。

[GitHub官方PostgreSQL service说明](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)支持健康检查及宿主端口映射。CI仅创建本job合成数据库，运行真实迁移和test:db，无生产URL/凭据。配置中的连接端点与容器内server事实要分别核对。

早审后改为受控 CI 步骤创建临时容器，以便在启动前生成随机 bootstrap 口令并注册 GitHub 掩码；不在 services.env 中使用可预测的值。官方镜像 [entrypoint](https://github.com/docker-library/postgres/blob/master/docker-entrypoint.sh) 支持 POSTGRES_PASSWORD_FILE；Docker 命令行只包含本job的私有文件路径，不包含凭证原文。脚本以独立 label/容器 ID 核验并在退出时清理。动态端口由 docker port 实测，不再使用 job 级 env 不支持的 job.services context。尚未取得远端 CI 通过证据。
