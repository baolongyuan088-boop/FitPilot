# iPhone 开发测试 App

这是通过 Xcode 签名、安装到 iPhone 的独立 iOS App。使用 UIKit 和 WKWebView，连接现有 FitPilot 云端服务；账号、记录和 AI 调用沿用线上版本。不是完整的原生页面重写，也不使用原项目默认的离线移动模式。

原生部分包含独立应用图标、持久登录容器、返回、重新加载、连接错误提示、更新内测网址和开源许可页面。仅加载本应用的 HTTPS 地址或自己的 baolongyuan.site 子域名，不忽略 TLS 验证，不包含数据库令牌、模型 API Key 或管理员初始化码。

## 构建和安装

1. `python3 ios-native/scripts/configure.py` 生成本地入口配置。可通过 `BETA_APP_URL` 环境变量或 `--url` 指定当前完整的内测链接。配置文件不提交 Git；其中的预览链接只用于本人的测试安装。
2. 在 Xcode 打开 `ios-native/FitPilot.xcodeproj`，选择自己的 Team 和已开启开发者模式的 iPhone。
3. 运行 FitPilot scheme，或用 `xcodebuild -project ios-native/FitPilot.xcodeproj -scheme FitPilot -destination 'id=你的设备UDID' -derivedDataPath ios-native/build -allowProvisioningUpdates DEVELOPMENT_TEAM=你的TeamID build`。
4. 编译通过后，可用 `xcrun devicectl device install app --device 你的设备UDID ios-native/build/Build/Products/Debug-iphoneos/FitPilot.app` 安装。实际打开和界面验收由 iPhone 或 Xcode 完成；编译通过不等于安装成功。

入口安全策略检查：`swiftc ios-native/App/AppEndpoint.swift ios-native/Tests/main.swift -o /tmp/fitpilot-endpoint-tests && /tmp/fitpilot-endpoint-tests`。

## 两个不同的有效期

- 免费 Personal Team 的设备测试配置通常 7 天到期，需要重新构建并安装，参见 [Apple Personal Team](https://developer.apple.com/help/account/basics/about-your-developer-account/)。
- 当前 EdgeOne 预览入口在中国大陆的有效期为 3 小时。安装 iOS App 不会延长平台预览权限；到期时在 App 设置中更新链接，长期使用仍需稳定的 HTTPS 域名，参见 [EdgeOne 域名说明](https://pages.edgeone.ai/document/domain-overview)。

保留上游 GNU AGPL-3.0-or-later 许可，App 内的“开源许可与来源”提供声明和仓库链接。
