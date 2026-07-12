# Fantetic Terminal 架构审计与演进方案

## 1. 结论摘要

当前系统已经从“单用户 Web SSH 工具”演进为具备 Web 与 Desktop 双运行模式、多用户、多分组、资产授权、审计事件和远程桌面网关的全栈终端平台。核心安全边界和大日志终端性能已经具备生产基础，但距离完整堡垒机仍有明确差距：管理端 UI、全量会话录像与回放、不可篡改审计、备份恢复、水平扩展和完整安全基线尚未闭环。

建议产品定位分两层：

- 当前版本：单节点部署的多用户远程终端管理平台。
- 目标版本：支持集中资产授权、会话审计、录像回放、密钥托管、审批和高可用的堡垒机。

禁止在会话录像、备份恢复和不可篡改审计完成前，对外宣称满足堡垒机合规要求。

## 2. 当前逻辑架构

```text
Browser / Electron Renderer
          |
          | HTTP + WebSocket
          v
Node.js Backend
  |- Auth / Session / Access Control
  |- Connections / SSH / SFTP / Telnet
  |- Settings / Appearance / Notifications
  |- Audit events / Imports / Transfers
  |- SQLite + local files
          |
          | short-lived signed token + shared secret
          v
Remote Gateway (Web only)
  |- Node gateway
  |- guacd
  |- RDP / VNC
```

Electron 复用前端和后端代码，但通过运行时能力模型关闭登录、RDP/VNC 和 remote-gateway；Web 模式启用登录和远程桌面。两者不再依赖分支分叉维护。

## 3. 已完成的架构治理

### 3.1 多用户、分组与资产授权

- 用户拥有 `systemRole` 和状态，支持 `super_admin/admin/user/auditor`。
- 分组支持 `owner/admin/operator/viewer`。
- 连接授权支持 `view/connect/manage`，并受组角色上限约束。
- Web HTTP 与 WebSocket 建连均执行服务端授权，不能依赖前端隐藏按钮。
- 连接、代理、SSH Key、目录、标签、快捷命令、历史、主题和外观数据已按用户隔离。
- 删除用户时要求资产接收人，并转移共享资产、清理私人数据。
- 修改或重置密码会提升 `auth_epoch`，使既有 HTTP/WS 会话失效。

### 3.2 Web 与 Desktop 运行模式

- Web：启用账户认证、RDP/VNC、remote-gateway。
- Desktop：本地单用户，无登录，禁用 RDP/VNC，不打包 remote-gateway。
- 能力判断集中在 runtime capability 层，不再散落按分支判断。
- Desktop CI 显式使用 Electron 构建模式，产物不包含 RDP/VNC/Guacamole 块。

### 3.3 终端数据面

- SSH 输出采用二进制帧、批处理和背压，限制单帧与待发送缓存。
- 输入具备快速路径、批处理和上限，避免浏览器或后端无限积压。
- 高亮采用有界缓存和行级语义复用，resize/reflow 不重新解析全部历史。
- 本地回显保留终端控制序列，解决历史命令移动光标后的错位。
- 大日志不会再因同步全量高亮阻塞页面主线程。

### 3.4 安全边界

- 生产 Web 模式对 `ENCRYPTION_KEY`、`SESSION_SECRET` 和 Gateway Secret fail-fast。
- 连接凭据和通知渠道凭据使用 AES-256-GCM 加密落盘。
- 通知旧明文 JSON 在首次读取时条件升级为密文。
- remote-gateway 使用共享密钥、短期令牌和一次性 nonce，防止伪造与重放。
- 审计日志仅 `auditor/admin/super_admin` 可读；通知配置仅系统管理员可管理。
- 反代来源、CORS origin 和受信代理 CIDR 已显式配置。

### 3.5 数据库与进程生命周期

- SQLite 启用 WAL、busy timeout、NORMAL synchronous 和 checkpoint 策略。
- 数据库迁移具有版本记录，当前多用户相关迁移可从旧库升级。
- HTTP、WebSocket、SQLite 在 SIGTERM/SIGINT 下统一优雅关闭。
- SQL 日志不再打印参数值，避免凭据进入日志。

### 3.6 前端启动与缓存

- Web/Desktop 和用户 ID 共同构成缓存命名空间。
- 切换用户、登出、401、改密后清理用户缓存。
- PWA 导航使用 network-first；API/WS 不进入 Service Worker 缓存；Desktop 不注册 SW。
- Monaco/CodeMirror 和设置弹层改为按需加载，主 JS 从约 5.33 MB（gzip 1.54 MB）降至约 1.03 MB（gzip 400 KB）。

### 3.7 构建与发布

- Docker 构建使用 lockfile 和 `npm ci`，不复制本地 `.env`。
- 三个镜像具备健康检查，Gateway 使用非 root 用户运行。
- Desktop 同时构建 Windows x64、Linux x64、macOS x64、macOS arm64。
- tag 必须严格等于 `v${version}`，Release 上传安装包和 SHA256 校验文件。
- 工作流提供可选 Windows/macOS 签名凭据入口。
- PR、`dev`、`main` 上执行关键行为测试和三包构建。

## 4. 仍需解决的问题

### P0：上线前必须处理

#### 4.1 缺少备份、恢复和灾难演练

问题：SQLite、上传文件、会话文件、自定义主题和运行密钥共同构成完整数据集，目前只有“自行备份 data 目录”的提示，没有一致性快照、恢复校验和版本兼容流程。

风险：直接复制 WAL 运行中的数据库可能得到不一致备份；丢失 `ENCRYPTION_KEY` 后所有密文永久不可恢复。

方案：

1. 实现维护模式或 SQLite Online Backup API。
2. 备份包含数据库、WAL checkpoint 后快照、上传文件、必要配置和 manifest。
3. manifest 记录应用版本、schema 版本、文件哈希、创建时间，不包含明文密钥。
4. 恢复前校验哈希、版本和剩余空间，恢复到临时目录后原子切换。
5. 建立每日自动备份、保留策略和异机恢复演练。

验收：在全新实例中只用备份和原密钥恢复，用户、分组、授权、连接、主题和通知配置一致；演练有 RPO/RTO 记录。

#### 4.2 审计不满足不可抵赖要求

问题：审计表只有时间、动作和自由 JSON；并非每条记录都有 actor、target、来源 IP、session、asset；应用进程和数据库管理员都能修改历史，超过 50000 条会自动删除。

风险：无法可靠回答“谁在何时通过什么入口对哪台资产做了什么”，不满足堡垒机审计目标。

方案：

1. 建立结构化 `audit_event`：actor、role、asset、session、request、source IP、action、result、reason、timestamp。
2. 使用请求上下文统一注入主体，禁止各业务手写不一致 details。
3. 引入 hash chain 或发送到外部 append-only/WORM 日志系统。
4. 保留策略按时间和合规要求配置，不在写入热路径逐条执行 COUNT/DELETE。
5. 日志写入失败对高风险操作采取 fail-closed 或同步告警。

验收：关键操作 100% 有结构化主体和目标；篡改单条日志可被验证程序发现；归档恢复可查询。

#### 4.3 缺少完整会话录像与回放

问题：当前记录登录、连接成功/失败等事件，挂起会话有临时输出文件，但没有覆盖所有 SSH/Telnet/RDP/VNC 会话的标准化输入输出录像、索引和回放。

风险：只能证明连接发生过，不能还原操作过程。

方案：

1. 在服务端数据面旁路记录输入、输出、resize、时间偏移和连接元数据。
2. SSH/Telnet 使用分块二进制记录；RDP/VNC 记录协议帧或服务端视频流。
3. 文件采用分段、压缩、加密、哈希和保留策略，不能阻塞实时终端。
4. 建立 session index、权限控制、回放播放器和导出审计。
5. 明确隐私遮罩、敏感输入禁录和管理员访问审计。

验收：断网、重连、resize、多字节字符和长会话可准确回放；录像写入不使 P95 交互延迟增加超过既定阈值。

#### 4.4 缺少系统化 Web 安全基线

问题：已有 CORS、SameSite Cookie、IP 控制和登录失败封禁，但未形成统一 CSP/安全 Header、CSRF origin 校验、API 通用限流、请求体 schema 校验和依赖漏洞门禁。

方案：

1. 增加 CSP、HSTS（仅 HTTPS）、frame-ancestors、nosniff 和 referrer policy。
2. 对 Cookie 认证的写请求验证 Origin/Fetch Metadata，或采用 CSRF token。
3. 登录、Passkey、2FA、测试通知、AI 和导入接口分别限流。
4. 用统一 schema 验证 HTTP/WS payload，限制字符串、数组和嵌套对象大小。
5. CI 增加依赖审计、secret scan、镜像扫描和 SBOM。

验收：OWASP ASVS 关键项有自动测试；跨站写请求被拒；畸形 WS 消息不会造成内存放大。

### P1：下一阶段核心演进

#### 4.5 缺少用户/分组/连接授权管理 UI

问题：服务端 API 和授权模型已经存在，但前端没有用户、组、成员和连接授权的完整管理入口。

方案：

1. `/auth/status` 返回 `systemRole`，前端只用于体验控制，最终授权仍由服务端执行。
2. 设置页新增访问控制模块：用户生命周期、组管理、成员角色、连接授权矩阵。
3. 连接编辑页显示 owner 和组授权，支持 `view/connect/manage`。
4. 普通用户仅查看自己所属组和被授权资产；审计员只读。
5. 所有危险操作增加确认、资产转移选择和结果反馈。

验收：管理员无需调用 API 即可完成用户创建、分组、授权、禁用、改密和删除转移；越权 UI 与 API 测试均通过。

#### 4.6 单节点状态阻碍水平扩展

问题：SQLite、FileStore Session、进程内 WebSocket/SSH session、nonce replay cache 和本地上传文件都绑定单实例。

方案：

1. 保持“单节点版”产品边界时明确部署限制并完善备份。
2. 需要高可用时迁移 PostgreSQL、Redis Session/nonce、对象存储和集中任务协调。
3. WebSocket 采用 sticky session 只能作为过渡；长期将会话所有权和控制面显式化。
4. SSH 数据面可拆为 session worker，控制面只负责授权和调度。

验收：任一 API 实例退出不影响登录态；会话 worker 故障的行为有明确恢复或终止语义。

#### 4.7 后端大文件和全局单例过多

证据：`sftp.service.ts` 约 1650 行，`transfers.service.ts` 约 927 行，`status-monitor.service.ts` 约 915 行，部分服务通过 WebSocket state 全局单例互相引用。

风险：修改一个协议路径容易影响其他路径，资源释放和并发状态难以测试。

方案：

1. 以 session 为聚合边界拆分 SFTP 浏览、上传、下载、压缩、文件操作。
2. 抽出 `SessionContext` 管理 SSH client、stream、SFTP、timer、abort signal 和 cleanup。
3. Handler 只做协议解析与授权，application service 编排，adapter 操作 ssh2/sqlite/ws。
4. 用依赖注入替代全局 state，测试可注入 fake transport 和 clock。

验收：单个模块建议控制在 300–500 行；会话关闭只有一个幂等 cleanup 入口；上传取消和断连有资源泄漏测试。

#### 4.8 前端巨型组件和状态职责混合

证据：`ConnectionsView.vue` 约 2974 行、`FileManager.vue` 约 1983 行、`WorkspaceView.vue` 约 1945 行、`LayoutRenderer.vue` 约 1480 行；设置与外观 store 接近 1000 行。

方案：

1. Connections 拆为资产树、连接工作区、工具栏、筛选和弹层协调器。
2. Workspace 拆为 session lifecycle、popout/fullscreen、terminal commands、file editor bridge。
3. FileManager 拆为 navigation、selection、clipboard、transfer queue、context menu。
4. Store 区分 server state、session state、UI state；API 访问集中到 feature service。
5. 保持终端热路径无额外响应式深代理。

验收：核心 composable 有行为测试；页面组件主要负责装配；修改文件操作不触碰终端生命周期代码。

#### 4.9 API/WS 契约重复且错误结构不统一

问题：前后端分别维护 WS 类型；错误响应混用 `message`、`code`、英文字符串和中文字符串；控制器大量 `any`。

方案：

1. 新建无运行时依赖的 shared-contract workspace。
2. 共享枚举、DTO、WS envelope 和错误 code；边界仍执行运行时校验。
3. 错误只返回稳定 code、args、requestId，前端负责 i18n。
4. 逐模块迁移，避免一次性全仓改名。

验收：契约变更同时触发前后端类型失败；用户界面不展示裸后端 key 或堆栈。

#### 4.10 可观测性不足

问题：仍有大量 `console.*` 和混合语言日志，没有统一 request/session correlation、指标和 tracing。

方案：

1. 统一结构化 logger，字段包含 requestId、userId、sessionId、assetId、component。
2. 默认脱敏 password/token/cookie/private key/notification config。
3. 指标覆盖登录、活跃会话、连接时延、WS bufferedAmount、输出丢弃、SQLite busy、Gateway/guacd。
4. readiness 区分数据库、磁盘和下游 Gateway；liveness 只反映进程。

验收：一次用户连接可跨 HTTP、WS、SSH/Gateway 关联；敏感字段扫描测试通过。

### P2：持续优化

#### 4.11 前端依赖与资源体积

- 全局 Element Plus 和 Font Awesome CSS 仍占据首屏较大比例。
- MDI 全图标索引约 2.8 MB，但已按需加载，不阻塞首屏。
- 编辑器块约 3.75 MB，但已隔离到首次打开编辑器。

方案：逐步使用按需组件注册、精简默认图标集合、为常用编辑器语言预热小块；建立首屏 JS/CSS budget，CI 超限失败。

#### 4.12 主题预设代码生成

前后端各有约 12000 行主题静态定义，容易重复和漂移。应保留单一源数据，由构建脚本生成前后端需要的格式，并对 hash/数量做一致性测试。

#### 4.13 Electron 安全与升级体验

需持续验证 `contextIsolation`、`sandbox`、IPC allowlist、外链打开策略；生产发布应完成 Windows 签名和 macOS 签名/公证，并为更新元数据增加签名验证、灰度和回滚。

#### 4.14 数据库性能

审计搜索 `LIKE '%term%'`、逐条写入后 COUNT 清理和部分 JSON 字段查询会随数据增长退化。应改为批量保留任务、必要索引或 FTS，并用真实规模数据做基准。

## 5. 推荐实施顺序

### 阶段 A：生产安全闭环

1. 备份/恢复与演练。
2. 结构化、不可篡改审计。
3. Web 安全 Header、CSRF、限流、schema 校验。
4. 完整签名、公证、SBOM 和镜像扫描。

### 阶段 B：堡垒机产品闭环

1. 用户/组/授权管理 UI。
2. 全协议会话录像、索引、回放和保留策略。
3. 审批流、临时授权、时间窗和命令策略。
4. 资产凭据轮换与外部密钥系统集成。

### 阶段 C：可维护性与规模化

1. 拆分巨型组件和 session 聚合。
2. 共享 API/WS 契约与统一错误模型。
3. 结构化日志、指标、追踪和容量基线。
4. 按实际规模决定继续单节点或迁移 PostgreSQL/Redis/Object Storage。

## 6. 架构验收门槛

- 安全：普通用户无法读取或修改其他用户资源、审计、通知密钥和系统设置。
- 性能：`tail -f -n 1000`、大文件 `cat`、history、滚动和 resize 不阻塞页面；高亮开关的吞吐差异有固定基准。
- 可靠性：SIGTERM 优雅关闭；上传、会话、timer、WS、DB 全部释放；备份可恢复。
- 交付：Web 与 Desktop 能力产物隔离；四平台桌面产物可复现；tag/version 一致；Release Assets 带校验和。
- 运维：健康检查、日志脱敏、关键指标和告警可用。
- 合规：关键操作具备结构化主体、资产和结果；会话可按权限检索和回放；审计可验证未被篡改。

## 7. 决策建议

短期不要立即微服务化。当前主要矛盾不是进程数量，而是安全闭环、会话审计和模块边界。先保持模块化单体和独立 Gateway，完成备份、审计、录像和管理 UI；只有出现多实例、高可用或会话容量的真实需求时，再把 session worker、数据库和对象存储外置。这样可以避免在业务边界尚未稳定时承担分布式事务、跨服务鉴权和运维复杂度。
