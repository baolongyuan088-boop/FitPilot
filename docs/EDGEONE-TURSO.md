# FitPilot 内测：EdgeOne + Turso

## 当前状态（2026-11-01）

- EdgeOne Makers 已有 `fitpilot` 项目，但控制台只显示预览入口，尚无可分享的公开域名；Cloud Functions 没有调用记录。不要把这个项目当成已上线的完整应用。
- Turso 账户下已创建独立的 `fitpilot-beta` 数据库（默认组，东京区域）。它目前是空库，未配置访问令牌，也没有导入 FitPilot 用户或训练数据。
- GitHub 的 FitPilot 主分支仍使用本地持久化 Node API。现有 EdgeOne 构建不是账户、邀请、同步和 AI 的可用后端。

## 迁移边界

现有 `api/server.js` 在启动时读取 `/data/secret` 和 `db.json`，把每位用户的状态写入 `state-<uid>.json`，并用 `server.listen()` 和定时器运行。EdgeOne Cloud Functions 按请求执行，不能把这些文件和进程内存当作跨请求的持久数据库。直接设置两个 Turso 环境变量并不会使旧 API 可用。

迁移时保持前端现有 `/api/*` 协议，分阶段实现：

1. **身份与邀请**：在 Turso 中建立用户、密码哈希、会话、单次邀请码表。邀请码领取必须在数据库事务中原子完成；首位管理员由部署时单独设置，不能由首位公开访问者自动取得。
2. **训练与饮食同步**：将 `/api/data` 的按用户文档和版本号迁入 Turso；保留现有冲突合并语义，并验证两台设备交替写入。
3. **AI 教练**：把模型密钥只放在 EdgeOne 服务端环境变量中，增加调用限额和失败回退；确认训练与饮食记录只发送必要字段。
4. **媒体与提醒**：照片等大文件迁到对象存储；后台定时任务及 Web Push 另行设计，不能假定请求函数会常驻。
5. **上线验收**：发布公开 HTTPS 域名，分别验证邀请码注册、退出重登、跨设备同步、AI 调用、手机浏览器及大陆网络访问。每一步失败时不发送朋友测试链接。

## 密钥与隔离

`TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN`、会话签名密钥、模型 API Key 只在 EdgeOne 服务端配置。不要放入 `VITE_*`、前端构建产物、GitHub 仓库或聊天消息。用户将在部署平台自行填写密钥。MyPT 和 FitPilot 使用不同数据库和令牌。

## 尚未完成

`edgeone-turso` 分支已实现 EdgeOne Cloud Function 的第一版：密码注册和登录、单次邀请码、管理员列表、按用户记录同步及版本冲突保护。AI 教练接口现支持计划生成、训练复盘、训练回顾、建议确认和撤回同意后的服务端清除。模型调用复用原有数据白名单、回答校验和确认流程；每位用户每天最多 3 次，并限制单次请求时间。本地 SQLite 接口测试和前端构建通过。尚未在 Turso 远程数据库或 EdgeOne 上验证。

AI 教练仅在服务端环境变量 `FITPILOT_AI_BASE_URL`、`FITPILOT_AI_MODEL`、`FITPILOT_AI_API_KEY` 全部设置后显示。Base URL 必须为 HTTPS 的 OpenAI-compatible Chat Completions API 根路径，例如平台提供的 `/api/v3`；模型 ID 以平台控制台当前开通的值为准。密钥不进入前端。账号与同步还需 `TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN`、`FITPILOT_SESSION_SECRET` 和 `FITPILOT_BOOTSTRAP_CODE`。首次管理员使用初始化邀请码注册；部署后不要把此邀请码发给朋友。

密码找回、通行密钥、照片媒体、提醒、完整管理员操作及原有全部同步兼容性仍未迁移。AI 教练的后台队列和跨用户总量限额尚未迁移；当前实现为请求内同步调用，按用户每日限额控制。前端只对已知不支持通行密钥的服务端隐藏该入口。这个分支**不可作为完整内测版上线**。用户自行填写的令牌、模型密钥、管理员初始化邀请码和会话签名密钥还未配置；域名绑定与手机端到端测试也未完成。当前没有可安全分享给朋友的 FitPilot 正式链接。
