import Combine
import Foundation

/// Where the Hub is, remembered between launches. Launching with
/// `-hubURL http://…` (UserDefaults' argument domain) sets it, for tests.
@MainActor
final class HubStore: ObservableObject {
  private static let key = "hubURL"
  private let defaults: UserDefaults
  @Published private(set) var url: URL?

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    url = defaults.string(forKey: Self.key).flatMap(HubAddress.normalize)
  }

  /// The last address used, to prefill the form after "Use another Hub".
  var lastAddress: String? { defaults.string(forKey: "lastHubAddress") }

  func use(_ url: URL) {
    defaults.set(url.absoluteString, forKey: Self.key)
    defaults.set(url.absoluteString, forKey: "lastHubAddress")
    self.url = url
  }

  func forget() {
    defaults.removeObject(forKey: Self.key)
    url = nil
  }
}

enum HubCheck {
  case ok
  case unreachable
  case untrustedCertificate
  case notAHub
}

enum HubAddress {
  static let httpPort = 7400
  static let httpsPort = 7443

  /// "192.168.1.20", "restro.local:7400" or "https://restro.local" → the Hub's
  /// base URL. Without a scheme it is plain HTTP; without a port, the Hub's.
  static func normalize(_ input: String) -> URL? {
    var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return nil }
    if !text.contains("://") { text = "http://\(text)" }
    guard var parts = URLComponents(string: text),
      let scheme = parts.scheme?.lowercased(), scheme == "http" || scheme == "https",
      let host = parts.host, !host.isEmpty
    else { return nil }
    parts.scheme = scheme
    if parts.port == nil { parts.port = scheme == "https" ? httpsPort : httpPort }
    parts.path = ""
    parts.query = nil
    parts.fragment = nil
    return parts.url
  }

  /// Whether a RestroOS Hub answers at the address (GET /api/v1/health).
  static func check(_ base: URL) async -> HubCheck {
    var request = URLRequest(
      url: base.appendingPathComponent("api/v1/health"), timeoutInterval: 5)
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    do {
      let (data, response) = try await URLSession(configuration: .ephemeral).data(for: request)
      guard (response as? HTTPURLResponse)?.statusCode == 200,
        let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        body["status"] is String, body["version"] is String
      else { return .notAHub }
      return .ok
    } catch let error as URLError {
      switch error.code {
      case .serverCertificateUntrusted, .serverCertificateHasUnknownRoot,
        .serverCertificateNotYetValid, .serverCertificateHasBadDate, .secureConnectionFailed:
        return .untrustedCertificate
      default:
        return .unreachable
      }
    } catch {
      return .unreachable
    }
  }
}
