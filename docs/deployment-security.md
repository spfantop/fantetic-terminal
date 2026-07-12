# 部署安全配置

Web/Docker 生产环境必须显式配置 `ENCRYPTION_KEY` 与 `SESSION_SECRET`，缺失或格式错误时后端拒绝启动，避免重启后临时密钥变化导致凭据无法解密或已有会话异常。

1. 复制 `.env.example` 为 `.env`。
2. 按示例命令分别生成密钥。
3. 设置真实的 `RP_ID`、`RP_ORIGIN` 与允许的 CORS 来源。
4. 执行 `docker compose up -d`。

`ENCRYPTION_KEY` 必须是 32 字节随机值对应的 64 位十六进制字符串；`SESSION_SECRET` 至少 32 个字符。不要把真实 `.env` 提交到仓库。

Desktop 模式没有 Web 登录入口。首次运行缺失密钥时会在应用数据目录的 `.env` 中原子生成并保存；后续启动复用同一份密钥。
