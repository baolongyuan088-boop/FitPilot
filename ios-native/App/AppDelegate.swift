import UIKit
import WebKit
import SafariServices

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "App", sessionRole: session.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.overrideUserInterfaceStyle = .dark
        window.rootViewController = UINavigationController(rootViewController: AppViewController())
        self.window = window
        window.makeKeyAndVisible()
    }
}

struct AppConfiguration {
    let title: String
    let allowedHost: String
    let defaultURL: String

    static func load() -> AppConfiguration {
        let location = Bundle.main.url(forResource: "AppConfiguration", withExtension: "plist")!
        let values = NSDictionary(contentsOf: location) as? [String: String] ?? [:]
        return AppConfiguration(title: values["Title"] ?? "健身管家",
                                allowedHost: values["AllowedHost"] ?? "",
                                defaultURL: values["DefaultURL"] ?? "")
    }
}

final class AppViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let configuration = AppConfiguration.load()
    private let webView = WKWebView(frame: .zero, configuration: {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        return configuration
    }())
    private let progress = UIProgressView(progressViewStyle: .bar)
    private let errorView = UIStackView()
    private let errorLabel = UILabel()
    private var progressObservation: NSKeyValueObservation?
    private var currentURL: URL? {
        let selected = UserDefaults.standard.string(forKey: "selectedAppURL") ?? configuration.defaultURL
        return AppEndpoint.validated(selected, allowedHost: configuration.allowedHost)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = configuration.title
        view.backgroundColor = .systemBackground
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        navigationController?.navigationBar.standardAppearance = appearance
        navigationController?.navigationBar.scrollEdgeAppearance = appearance
        navigationItem.leftBarButtonItem = UIBarButtonItem(image: UIImage(systemName: "chevron.left"),
            style: .plain, target: self, action: #selector(back))
        navigationItem.rightBarButtonItems = [
            UIBarButtonItem(image: UIImage(systemName: "gearshape"), style: .plain,
                            target: self, action: #selector(settings)),
            UIBarButtonItem(image: UIImage(systemName: "arrow.clockwise"), style: .plain,
                            target: self, action: #selector(reloadApp))
        ]
        navigationItem.leftBarButtonItem?.accessibilityLabel = "返回"
        navigationItem.rightBarButtonItems?[0].accessibilityLabel = "应用设置"
        navigationItem.rightBarButtonItems?[1].accessibilityLabel = "重新加载"
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.backgroundColor = .systemBackground
        webView.translatesAutoresizingMaskIntoConstraints = false
        progress.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        view.addSubview(progress)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            progress.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            progress.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progress.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        errorView.axis = .vertical
        errorView.spacing = 20
        errorView.alignment = .fill
        errorView.translatesAutoresizingMaskIntoConstraints = false
        errorView.isHidden = true
        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center
        errorLabel.font = .preferredFont(forTextStyle: .body)
        errorView.addArrangedSubview(errorLabel)
        for (name, action) in [("重试", #selector(reloadApp)), ("更新内测网址", #selector(settings))] {
            let button = UIButton(type: .system)
            button.setTitle(name, for: .normal)
            button.addTarget(self, action: action, for: .touchUpInside)
            errorView.addArrangedSubview(button)
        }
        view.addSubview(errorView)
        NSLayoutConstraint.activate([
            errorView.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
            errorView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            errorView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32)
        ])
        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] _, _ in
            guard let self = self else { return }
            self.progress.progress = Float(self.webView.estimatedProgress)
            self.progress.isHidden = self.webView.estimatedProgress >= 1
        }
        reloadApp()
    }

    @objc private func back() { if webView.canGoBack { webView.goBack() } }
    @objc private func reloadApp() {
        guard let url = currentURL else { showError("请先在应用设置中填写有效的 HTTPS 内测网址。"); return }
        errorView.isHidden = true
        webView.isHidden = false
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 45))
    }
    private func showError(_ message: String) {
        webView.isHidden = true
        progress.isHidden = true
        errorLabel.text = message
        errorView.isHidden = false
    }
    @objc private func settings() {
        let controller = AppSettingsViewController(configuration: configuration,
            selectedURL: currentURL?.absoluteString ?? configuration.defaultURL)
        controller.onSave = { [weak self] in self?.reloadApp() }
        present(UINavigationController(rootViewController: controller), animated: true)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        navigationItem.leftBarButtonItem?.isEnabled = webView.canGoBack
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail(error)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail(error)
    }
    private func fail(_ error: Error) {
        if (error as NSError).code != NSURLErrorCancelled {
            showError("暂时无法连接。请检查网络后重试；测试网址过期时，可在设置里更新。");
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if response.isForMainFrame, let http = response.response as? HTTPURLResponse, http.statusCode == 401 {
            decisionHandler(.cancel)
            showError("内测网址已失效或访问受限。请在应用设置中粘贴新的内测网址。")
            return
        }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
        if AppEndpoint.validated(url.absoluteString, allowedHost: configuration.allowedHost) != nil {
            if action.targetFrame == nil { webView.load(action.request); decisionHandler(.cancel) }
            else { decisionHandler(.allow) }
        } else {
            decisionHandler(.cancel)
            if action.navigationType == .linkActivated, url.scheme == "https" {
                present(SFSafariViewController(url: url), animated: true)
            }
        }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: configuration.title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: configuration.title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "确认", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
}

final class AppSettingsViewController: UIViewController {
    private let configuration: AppConfiguration
    private let address = UITextView()
    private let selectedURL: String
    var onSave: (() -> Void)?

    init(configuration: AppConfiguration, selectedURL: String) {
        self.configuration = configuration
        self.selectedURL = selectedURL
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "应用设置"
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "取消", style: .plain,
            target: self, action: #selector(cancel))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "保存", style: .done,
            target: self, action: #selector(save))
        let label = UILabel()
        label.text = "内测网址\n粘贴已获得的完整测试链接，或你的正式网址。"
        label.numberOfLines = 0
        label.font = .preferredFont(forTextStyle: .body)
        address.text = selectedURL
        address.font = .preferredFont(forTextStyle: .body)
        address.keyboardType = .URL
        address.autocorrectionType = .no
        address.autocapitalizationType = .none
        address.smartDashesType = .no
        address.smartQuotesType = .no
        address.backgroundColor = .secondarySystemBackground
        address.layer.cornerRadius = 12
        address.accessibilityLabel = "内测网址"
        let notices = UIButton(type: .system)
        notices.setTitle("开源许可与来源", for: .normal)
        notices.addTarget(self, action: #selector(showNotices), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [label, address, notices])
        stack.axis = .vertical
        stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            address.heightAnchor.constraint(equalToConstant: 180)
        ])
    }
    @objc private func cancel() { dismiss(animated: true) }
    @objc private func save() {
        guard let url = AppEndpoint.validated(address.text, allowedHost: configuration.allowedHost) else {
            let alert = UIAlertController(title: "请检查网址", message: "请使用本应用的 HTTPS 测试网址，或 baolongyuan.site 的子域名。", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "好", style: .default))
            present(alert, animated: true)
            return
        }
        UserDefaults.standard.set(url.absoluteString, forKey: "selectedAppURL")
        dismiss(animated: true) { [weak self] in self?.onSave?() }
    }
    @objc private func showNotices() {
        let controller = UIViewController()
        controller.title = "开源许可与来源"
        let text = UITextView()
        text.isEditable = false
        text.font = .preferredFont(forTextStyle: .footnote)
        text.textContainerInset = UIEdgeInsets(top: 20, left: 16, bottom: 20, right: 16)
        if let url = Bundle.main.url(forResource: "OpenSourceNotices", withExtension: "txt") {
            text.text = try? String(contentsOf: url, encoding: .utf8)
        }
        controller.view = text
        navigationController?.pushViewController(controller, animated: true)
    }
}
