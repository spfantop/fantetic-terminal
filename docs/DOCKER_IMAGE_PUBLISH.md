# Docker Hub 镜像自动发布

`.github/workflows/docker-publish.yml` 会构建并推送以下多架构镜像：

- `fantetic-terminal-frontend`
- `fantetic-terminal-backend`
- `fantetic-terminal-remote-gateway`

每个镜像同时包含 `linux/amd64` 与 `linux/arm64`。默认 Compose 文件使用 `spfantop` 命名空间；因此生产仓库应将 Docker Hub 用户名配置为 `spfantop`。

## 配置 GitHub Repository Secrets

1. 登录 Docker Hub，进入 **Account Settings → Personal access tokens**。
2. 创建一个具备 **Read & Write** 权限的 access token；不要使用 Docker Hub 登录密码。
3. 打开 GitHub 仓库：**Settings → Secrets and variables → Actions → New repository secret**。
4. 创建以下两个 Secret：

   - `DOCKERHUB_USERNAME`：Docker Hub 用户名，例如 `spfantop`。
   - `DOCKERHUB_TOKEN`：刚创建的 Docker Hub access token。

Secret 保存后不可再读取。若 token 泄露，请立即在 Docker Hub 撤销并重新创建。

## 触发规则与镜像标签

- 推送 `main`：发布 `main`、`sha-<commit>` 与 `latest`。
- 推送 `v2.0.1`：发布 `2.0.1`、`2.0`、`2` 与 `sha-<commit>`。
- 在 **Actions → Publish Docker images → Run workflow** 手动触发：发布当前分支对应的分支与 SHA 标签；只有默认分支会更新 `latest`。

发布前，工作流会校验 `DOCKERHUB_USERNAME` 与 `DOCKERHUB_TOKEN`。任一缺失时会在登录 Docker Hub 前明确失败，避免构建完成后才暴露凭据问题。

## 验证

发布完成后可执行：

```bash
docker buildx imagetools inspect spfantop/fantetic-terminal-frontend:latest
docker pull spfantop/fantetic-terminal-backend:2.0.1
```

`imagetools inspect` 的 manifest 列表应同时包含 `linux/amd64` 和 `linux/arm64`。
