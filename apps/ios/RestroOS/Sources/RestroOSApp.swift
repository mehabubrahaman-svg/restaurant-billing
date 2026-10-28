import SwiftUI

/// The iPad and iPhone client (docs/adr/0011): the Hub's own web app in a
/// full-screen web view, once the app knows where the Hub is.
@main
struct RestroOSApp: App {
  @StateObject private var hub = HubStore()

  var body: some Scene {
    WindowGroup {
      RootView().environmentObject(hub)
    }
  }
}

/// Asks for the Hub until it has one; shaking the device offers to change it.
struct RootView: View {
  @EnvironmentObject private var hub: HubStore
  @State private var askToChange = false

  var body: some View {
    Group {
      if let url = hub.url {
        HubScreen(url: url)
      } else {
        ConnectView()
      }
    }
    .onReceive(NotificationCenter.default.publisher(for: .deviceDidShake)) { _ in
      if hub.url != nil { askToChange = true }
    }
    .confirmationDialog(Text("change.title"), isPresented: $askToChange, titleVisibility: .visible) {
      Button("change.confirm", role: .destructive) { hub.forget() }
      Button("common.cancel", role: .cancel) {}
    } message: {
      Text("change.message")
    }
  }
}

extension Notification.Name {
  static let deviceDidShake = Notification.Name("RestroOSDeviceDidShake")
}

extension UIWindow {
  open override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
    if motion == .motionShake { NotificationCenter.default.post(name: .deviceDidShake, object: nil) }
    super.motionEnded(motion, with: event)
  }
}
