# 部署安全配置

Docker 生产环境首次启动时会自动生成 `ENCRYPTION_KEY`、`SESSION_SECRET` 与 `REMOTE_GATEWAY_SHARED_SECRET`，并原子保存到挂载数据目录的 `data/.env`。后续启动复用同一份密钥，避免加密数据无法解密、已有会话异常，以及 Backend 与 Remote Gateway 共享密钥不一致。

1. 复制 `.env.example` 为 `.env`。
2. 设置真实的 `RP_ID`、`RP_ORIGIN` 与允许的 CORS 来源。
3. 执行 `docker compose up -d`。

不要提交或删除 `data/.env`；应将其与 `data` 目录一起进行受保护的备份。需要自行管理密钥时，可在首次启动前将有效值写入 `data/.env`。

Desktop 模式没有 Web 登录入口。首次运行缺失密钥时会在应用数据目录的 `.env` 中原子生成并保存；后续启动复用同一份密钥。
