import Foundation

let host = "fitpilot.zh-cn.edgeone.cool"
let valid = ["https://\(host)/?eo_token=example&eo_time=1", "https://fit.baolongyuan.site/#/login"]
let invalid = ["http://\(host)", "https://\(host).evil.example/", "https://evilbaolongyuan.site/", "https://user:password@\(host)/", "https://\(host):8080/", "javascript:alert(1)"]
for url in valid { precondition(AppEndpoint.validated(url, allowedHost: host) != nil, "Valid endpoint rejected") }
for url in invalid { precondition(AppEndpoint.validated(url, allowedHost: host) == nil, "Unsafe endpoint accepted") }
print("App endpoint policy: 8 cases passed")
