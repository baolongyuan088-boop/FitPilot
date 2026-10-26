# 腾讯云轻量服务器内测上线

FitPilot 需要长期运行的 Node API 和可持久写入的 `data/`。只上传 `frontend/dist/` 到 EdgeOne Makers 不会提供账号、邀请码、同步和 AI 教练。以下步骤针对一台新建的腾讯云轻量应用服务器；开通服务器、域名解析和备案应在腾讯云账户中由所有者完成。

## 上线前

1. 准备一台装有 Docker Engine、Compose 插件和 HTTPS 反向代理的轻量服务器，保留持久磁盘并开放 80/443。不要把 3000 或 8080 直接开放到公网。
2. 确定最终域名，例如 `fitpilot.baolongyuan.site`。大陆服务器的域名须先完成相应备案；域名解析到服务器公网 IP，并配置 HTTPS。RP_ID 一旦用于注册通行密钥，改域名会使旧通行密钥失效。
3. 从自己的 GitHub 仓库拉取源码。不要上传本机 `data/`、`.env`、模型密钥或个人训练记录。

## 首次部署

在服务器项目目录复制 `.env.example` 为 `.env`，至少设置：

```dotenv
RP_ID=fitpilot.baolongyuan.site
ORIGIN=https://fitpilot.baolongyuan.site
RP_NAME=轻燃
DEFAULT_LANG=zh
WEB_PORT=8080
FIRST_USER_ADMIN=1
INVITE_ONLY=0
ALLOW_GUEST=0
PASSWORD_LOGIN=1
```

先保持 `INVITE_ONLY=0`，并在首次注册期间用反向代理或防火墙只允许所有者访问。由所有者通过 HTTPS 注册第一个账号，确认「设置 → 账户 → 管理后台」可见，再在服务器 `.env` 中设 `INVITE_ONLY=1` 并重启，然后开放测试者访问。否则尚无管理员时，所有人都无法生成邀请码；公开首个注册窗口也可能让别人抢先成为管理员。

使用本仓库源码构建两个容器，避免拉取上游的预制镜像：

```sh
docker compose up -d --build
```

HTTPS 反向代理将域名的请求转发到本机 `127.0.0.1:8080`。此仓库的 `docker-compose.yml` 已将 8080 绑定到本机；保持 `./data` 的持久化卷并定期备份。

## 给朋友的邀请码

管理员登录后，打开「设置 → 账户 → 管理后台 → 邀请码」，点击生成。每个邀请码只能用于创建一个档案，给不同朋友分别生成。发给朋友 `https://fitpilot.baolongyuan.site` 和其专属邀请码，不要发送管理账号、服务器密码或 AI API Key。

## 上线验收

- 手机浏览器打开 HTTPS 域名，默认显示中文；从 Safari 可以添加到主屏幕。
- 无邀请码不能注册；有效邀请码只能使用一次；两个测试账号的训练和饮食数据互相隔离。
- 服务重启后账号和训练记录仍在；备份可恢复。
- AI 教练由管理员在后台填写模型密钥并实际测试成功；密钥不出现在客户端构建或 Git 仓库。
- 检查 HTTPS、健康接口和容器日志，不以网页首屏能打开代替完整验收。

当前状态：仅准备部署方案；未购买服务器、未配置 DNS/备案/HTTPS、未生成线上邀请码，不能把本地网页地址发给朋友。
