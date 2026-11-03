import Foundation

/// Keep account cookies and records on the selected app's server.
enum AppEndpoint {
    static func validated(_ value: String, allowedHost: String) -> URL? {
        guard let components = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.scheme?.lowercased() == "https",
              let host = components.host?.lowercased(),
              host == allowedHost.lowercased() || host.hasSuffix(".baolongyuan.site"),
              components.user == nil, components.password == nil,
              components.port == nil || components.port == 443,
              let url = components.url else { return nil }
        return url
    }
}
