# Docker Hub 镜像自动发布

`.github/workflows/docker-publish.yml` 会构建并推送以下多架构镜像：

- `fantetic-terminal-frontend`
- `fantetic-terminal-backend`
- `fantetic-terminal-remote-gateway`
- `fantetic-terminal`（完整单镜像）

每个镜像同时包含 `linux/amd64` 与 `linux/arm64`。工作流会发布四个仓库：`fantetic-terminal`（完整单镜像）、`fantetic-terminal-frontend`、`fantetic-terminal-backend`、`fantetic-terminal-remote-gateway`。默认 Compose 文件与发布模块固定使用 `spfantop` 命名空间；因此 Docker Hub 凭据必须属于 `spfantop`。

## 配置 GitHub Repository Secrets

1. 登录 Docker Hub，进入 **Account Settings → Personal access tokens**。
2. 创建一个具备 **Read 与 Write** 权限的 access token；不要使用 Docker Hub 登录密码。
3. 打开 GitHub 仓库：**Settings → Secrets and variables → Actions → New repository secret**。
4. 创建以下两个 Secret：

   - `DOCKERHUB_USERNAME`：Docker Hub 用户名，例如 `spfantop`。
   - `DOCKERHUB_TOKEN`：刚创建的 Docker Hub access token。

Secret 保存后不可再读取。若 token 泄露，请立即在 Docker Hub 撤销并重新创建。

## 触发规则与发布集合

- 推送 `vX.Y.Z` 标签：版本必须与根 `package.json` 和 Electron 版本完全一致。
- 在 **Actions → Publish Docker images → Run workflow** 手动触发：输入的版本也必须与当前源码版本完全一致。
- 四个 matrix job 只推送 digest candidate，不直接写版本标签。
- publish job 收齐四个摘要后验证 `linux/amd64`、`linux/arm64` 和不可变版本标签，再依次发布同一 `X.Y.Z` 版本集合。
- 只有完整单镜像 `fantetic-terminal` 保留便利性的 `latest` 标签；分布式 Compose 镜像只使用不可变版本标签。
- 成功后上传 `docker-release-manifest-X.Y.Z` Actions artifact，并把 `fantetic-terminal-docker-release-X.Y.Z.json` 附加到对应 GitHub Release；二者都记录源码 revision、四个镜像摘要、平台和 `complete` 状态。

发布前，release-set module 会验证版本、镜像清单和源码 revision；Docker 登录步骤验证 `DOCKERHUB_USERNAME` 与 `DOCKERHUB_TOKEN`。任一 candidate 构建失败时 publish job 不会运行。

该完整清单机制适用于采用 release-set module 后创建的 Docker 版本；之前已有的版本标签属于迁移基线，不会追溯生成清单。

## 失败恢复

如果 promotion 或 GitHub Release 上传失败，优先在同一个 workflow run 中重试失败的 publish job，以复用已记录的 candidate 摘要。版本标签摘要相同时重试是幂等的；若版本标签已存在但摘要不同，module 会拒绝覆盖。此时必须先确认该版本没有被部署，再由仓库维护者在 Docker Hub 中处理冲突标签，禁止通过 workflow 静默替换。

## 验证

发布完成后可执行：

```bash
docker buildx imagetools inspect spfantop/fantetic-terminal-frontend:2.1.3
docker buildx imagetools inspect spfantop/fantetic-terminal:latest
docker pull spfantop/fantetic-terminal-backend:2.1.3
```

`imagetools inspect` 的 manifest 列表应同时包含 `linux/amd64` 和 `linux/arm64`，且摘要应与 completed release manifest 一致。Compose 部署必须把 `.env` 中的 `FANTETIC_VERSION` 设置为这个完成版本。
