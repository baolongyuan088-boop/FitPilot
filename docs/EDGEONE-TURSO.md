# FitPilot 内测：EdgeOne + Turso

## 朋友使用自己的账号（2026-11-03）

`edgeone-turso` 提供账号密码登录。管理员先使用本地部署配置中的 FITPILOT_BOOTSTRAP_CODE 注册首个管理账号，再在应用的管理页面生成单次邀请码。朋友用邀请码注册自己的账号并设置密码，后续直接登录；训练和饮食记录按账号保存。首个管理账号必须由项目所有者创建，不能用自动生成的测试账号占用。

登录页已增加注册及手机主屏幕安装说明；`--mode fitpilot` 构建显式禁用演示模式，防止平台残留的 VITE_DEMO=1 把真实账号入口变成演示入口。AI 由服务端配置，朋友无需填写模型密钥。现有内测范围仍适用，照片和后台提醒尚不支持。

上线前仍需核实云端环境变量、切换到迁移分支部署，并完成真实注册、跨账号隔离和 AI 验收。登录页文字与本地构建通过不代表已切换生产；旧 main 分支演示入口不能用于朋友账号登录。

## 当前状态（2026-11-02）

- EdgeOne Makers 的 `fitpilot` 项目已成功发布 `edgeone-turso` 分支预览部署 `dp1g85q2mrlz`（代码 `101ff75`），生成 Node 云函数路由 `/api/*`。实际访问 `/api/health` 已返回缺少数据库地址、数据库令牌和会话签名密钥的配置错误，证明请求已进入新后端；数据库和 AI 尚未接通。控制台仅提供 3 小时限时预览，尚无可分享的公开域名。
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

`edgeone-turso` 分支已实现 EdgeOne Cloud Function 的第一版：密码注册和登录、单次邀请码、管理员列表、按用户记录同步及版本冲突保护。AI 教练接口现支持计划生成、训练复盘、训练回顾、建议确认和撤回同意后的服务端清除。模型调用复用原有数据白名单、回答校验和确认流程；每位用户每天最多 3 次，并限制单次请求时间。本地 SQLite 接口测试和前端构建通过，EdgeOne 构建与函数启动已经实测。Turso 远程数据读写和真实模型返回尚未验证。

AI 教练仅在服务端环境变量 `FITPILOT_AI_BASE_URL`、`FITPILOT_AI_MODEL`、`FITPILOT_AI_API_KEY` 全部设置后显示。Base URL 必须为 HTTPS 的 OpenAI-compatible Chat Completions API 根路径，例如平台提供的 `/api/v3`；模型 ID 以平台控制台当前开通的值为准。密钥不进入前端。账号与同步还需 `TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN`、`FITPILOT_SESSION_SECRET` 和 `FITPILOT_BOOTSTRAP_CODE`。首次管理员使用初始化邀请码注册；部署后不要把此邀请码发给朋友。

密码重置、当前密码验证、退出全部设备、管理员查看/停用/删除账户已经迁移。通行密钥、设备配对、照片上传、后台提醒与审计暂不支持，对应入口已经关闭。AI 教练采用请求内同步调用，每位用户每日 3 个任务，全站默认每日 30 个任务（FITPILOT_AI_DAILY_LIMIT），按 UTC 计数；每个任务可进行有限的模型重试和一次回答修复。模型整体等待限制为 45 秒。此版本面向密码账号、记录同步和 AI 教练的限定内测，尚未完成云端验收。用户自行填写的令牌、模型密钥、管理员初始化邀请码和会话签名密钥还未配置；域名绑定与手机端到端测试也未完成。当前没有可安全分享给朋友的 FitPilot 正式链接。


## 当前部署操作

2026-11-02 已核对控制台：原项目根目录为 frontend，构建命令带 VITE_DEMO=1；生产仍指向 main。已将项目根目录改为 ./、输出目录 frontend/dist、安装命令 npm ci && npm --prefix frontend ci、构建命令 npm run build。仓库新增 edgeone.json 固定构建配置与 60 秒云函数限制（[平台配置文档](https://makers.edgeone.link/document/edgeone-json)）。后端代码与测试位于 server/edgeone，仅 cloud-functions/api/[[default]].js 作为函数入口。

首轮构建因 Node.js 22.22.0 不在平台预装列表中失败，已改为控制台实际提供的 22.21.1；按 builder 20260817 的提示，将限制配置写为 cloudFunctions.maxDuration。修正后构建和部署共 59 秒，云函数地域为 ap-guangzhou。生产分支 main 尚未切换；后续应先验收迁移分支，再切换生产。

部署时选择 edgeone-turso 分支。Turso 控制台详情初次偶发 Oops，刷新后可见 fitpilot-beta，URL 已抄入本地 .env.edgeone.local。此文件有独立随机会话密钥和初始化邀请码，权限 0600 且被 gitignore 排除。用户需替换数据库令牌、模型 ID、API Key 三个占位值，并在腾讯云项目设置的环境变量窗口批量导入。不要把此文件提交到仓库。

部署后先检查 /api/health（仅证明数据库可达和是否配置模型），然后实际验收注册、退出重登、跨用户隔离、两设备同步、AI 返回及确认。中国大陆项目仍需要自定义域名，域名与可分享入口尚待核实；构建成功不等于手机可访问。
