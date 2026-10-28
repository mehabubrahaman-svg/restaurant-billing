import SwiftUI
import WebKit

/// The Hub's web app, full screen, with a way back when the Hub can't be reached.
struct HubScreen: View {
  let url: URL
  @EnvironmentObject private var hub: HubStore
  @State private var failed = false
  @State private var reloads = 0

  var body: some View {
    ZStack {
      HubWebView(url: url, reloads: reloads, failed: $failed)
        .ignoresSafeArea(.container, edges: .bottom)
      if failed {
        VStack(spacing: 16) {
          Image(systemName: "wifi.exclamationmark").font(.system(size: 44)).accessibilityHidden(true)
          Text("hub.unreachable.title").font(.title2.bold())
          Text("hub.unreachable.body \(url.absoluteString)").multilineTextAlignment(.center)
          HStack(spacing: 12) {
            Button("hub.retry") {
              failed = false
              reloads += 1
            }
            .buttonStyle(.borderedProminent)
            Button("hub.change") { hub.forget() }.buttonStyle(.bordered)
          }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
      }
    }
  }
}

/// A WKWebView on the Hub: its cookies and storage persist, links elsewhere
/// open in Safari, JavaScript dialogs and file downloads (CSV exports) work.
struct HubWebView: UIViewRepresentable {
  let url: URL
  /// Changing it reloads the page.
  let reloads: Int
  @Binding var failed: Bool

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  func makeUIView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.allowsInlineMediaPlayback = true
    // The kitchen display chimes for new tickets without a tap first.
    config.mediaTypesRequiringUserActionForPlayback = []
    let view = WKWebView(frame: .zero, configuration: config)
    view.navigationDelegate = context.coordinator
    view.uiDelegate = context.coordinator
    view.allowsBackForwardNavigationGestures = false
    #if DEBUG
      if #available(iOS 16.4, *) { view.isInspectable = true }
    #endif
    context.coordinator.webView = view
    context.coordinator.loadedReloads = reloads
    view.load(URLRequest(url: url))
    return view
  }

  func updateUIView(_ view: WKWebView, context: Context) {
    context.coordinator.parent = self
    guard context.coordinator.loadedReloads != reloads else { return }
    context.coordinator.loadedReloads = reloads
    if view.url == nil { view.load(URLRequest(url: url)) } else { view.reload() }
  }

  @MainActor
  final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    var parent: HubWebView
    var loadedReloads = 0
    weak var webView: WKWebView?
    private var downloads: [ObjectIdentifier: URL] = [:]

    init(_ parent: HubWebView) { self.parent = parent }

    // ---- loading -------------------------------------------------------------------
    func webView(
      _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
      withError error: Error
    ) {
      // A load replaced by another (the app navigated again) isn't a failure.
      if (error as NSError).code == NSURLErrorCancelled { return }
      parent.failed = true
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
      parent.failed = false
    }

    /// The page's process was ended (memory pressure in the background): load it again.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
      webView.reload()
    }

    func webView(
      _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction
    ) async -> WKNavigationActionPolicy {
      if navigationAction.shouldPerformDownload { return .download }
      guard let target = navigationAction.request.url else { return .cancel }
      let scheme = target.scheme?.lowercased() ?? ""
      if ["blob", "data", "about"].contains(scheme) || target.host == parent.url.host {
        return .allow
      }
      // Anything that isn't the Hub (a help page, a payment link) opens in Safari.
      _ = await UIApplication.shared.open(target)
      return .cancel
    }

    func webView(
      _ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse
    ) async -> WKNavigationResponsePolicy {
      navigationResponse.canShowMIMEType ? .allow : .download
    }

    /// target="_blank" and window.open: the same view, there are no tabs.
    func webView(
      _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
      for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
      if navigationAction.targetFrame == nil, let target = navigationAction.request.url {
        webView.load(URLRequest(url: target))
      }
      return nil
    }

    // ---- JavaScript dialogs -----------------------------------------------------------
    func webView(
      _ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
      initiatedByFrame frame: WKFrameInfo
    ) async {
      _ = await ask(message, cancellable: false)
    }

    func webView(
      _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
      initiatedByFrame frame: WKFrameInfo
    ) async -> Bool {
      await ask(message, cancellable: true)
    }

    private func ask(_ message: String, cancellable: Bool) async -> Bool {
      guard let presenter = webView?.window?.rootViewController?.topmost else { return false }
      return await withCheckedContinuation { done in
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        if cancellable {
          alert.addAction(
            UIAlertAction(title: String(localized: "common.cancel"), style: .cancel) { _ in
              done.resume(returning: false)
            })
        }
        alert.addAction(
          UIAlertAction(title: String(localized: "common.ok"), style: .default) { _ in
            done.resume(returning: true)
          })
        presenter.present(alert, animated: true)
      }
    }

    // ---- downloads ----------------------------------------------------------------------
    func webView(
      _ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload
    ) {
      download.delegate = self
    }

    func webView(
      _ webView: WKWebView, navigationResponse: WKNavigationResponse,
      didBecome download: WKDownload
    ) {
      download.delegate = self
    }

    func download(
      _ download: WKDownload, decideDestinationUsing response: URLResponse,
      suggestedFilename: String
    ) async -> URL? {
      let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
      try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      let file = folder.appendingPathComponent(suggestedFilename)
      downloads[ObjectIdentifier(download)] = file
      return file
    }

    /// A finished file goes to the share sheet: save it to Files, mail it, AirDrop it.
    func downloadDidFinish(_ download: WKDownload) {
      guard let file = downloads.removeValue(forKey: ObjectIdentifier(download)),
        let webView, let presenter = webView.window?.rootViewController?.topmost
      else { return }
      let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
      sheet.popoverPresentationController?.sourceView = webView
      sheet.popoverPresentationController?.sourceRect = CGRect(
        x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
      presenter.present(sheet, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
      downloads.removeValue(forKey: ObjectIdentifier(download))
    }
  }
}

extension UIViewController {
  /// The controller on top, to present over whatever is showing.
  var topmost: UIViewController { presentedViewController?.topmost ?? self }
}
