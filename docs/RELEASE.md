# 发布桌面版本

桌面安装包由 `.github/workflows/desktop-build.yml` 在 Windows、Linux、macOS x64 和 macOS arm64 上分别构建。

## 标准发布流程

1. 修改根目录 `package.json` 的 `version`，例如 `1.5.3`。
2. 本地执行 `npm run test:delivery`，并完成常规构建与测试。
3. 合并版本提交后创建并推送严格匹配的标签 `v${version}`，例如 `v1.5.3`。
4. `Build desktop applications` 成功后，会创建或更新同名 GitHub Release，并把 Windows 标准安装包 `-setup.exe`、Windows 绿色包 `-portable.exe`、`.AppImage`、`.deb`、`.dmg` 与 `SHA256SUMS.txt` 上传到 Release Assets。

也可手动运行工作流并填写 `release_tag`。该值仍必须严格等于 `v${version}`；留空时只生成 Actions Artifact，不创建 GitHub Release。

## Artifact 与 Release Assets

- `Upload desktop packages` 生成的是 Actions Artifact，只在工作流运行详情中保留 14 天。
- `Publish GitHub Release assets` 才会把文件放入 GitHub Release 的 Assets 区域。
- tag 推送或手动填写 `release_tag` 是执行发布作业的必要条件。

## 签名

工作流支持通过仓库 Secrets 注入 Windows/macOS 证书。没有配置证书时仍会生成未签名安装包，但 Windows SmartScreen 和 macOS Gatekeeper 可能提示风险。

- Windows：`WINDOWS_CSC_LINK`、`WINDOWS_CSC_KEY_PASSWORD`
- macOS：`MACOS_CSC_LINK`、`MACOS_CSC_KEY_PASSWORD`

macOS 公证还需要单独配置 Apple 开发者凭据并在发布前验证；未完成公证的 DMG 不应宣称为已公证产物。
