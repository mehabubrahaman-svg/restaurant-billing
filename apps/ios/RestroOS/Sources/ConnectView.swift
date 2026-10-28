import SwiftUI

/// First run (and "Use another Hub"): the Hub's address, checked before it is kept.
struct ConnectView: View {
  @EnvironmentObject private var hub: HubStore
  @State private var address = ""
  @State private var checking = false
  @State private var problem: LocalizedStringKey?

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Text(verbatim: "R")
          .font(.system(size: 40, weight: .bold))
          .foregroundStyle(.white)
          .frame(width: 72, height: 72)
          .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 16))
          .accessibilityHidden(true)
        Text("connect.title").font(.largeTitle.bold())
        Text("connect.body").foregroundStyle(.secondary)
        TextField("connect.placeholder", text: $address)
          .textFieldStyle(.roundedBorder)
          .font(.title3)
          .keyboardType(.URL)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .submitLabel(.go)
          .onSubmit(connect)
          .accessibilityLabel(Text("connect.label"))
        if let problem {
          Text(problem).foregroundStyle(.red)
        }
        Button(action: connect) {
          Group {
            if checking { ProgressView() } else { Text("connect.button") }
          }
          .frame(maxWidth: .infinity, minHeight: 32)
        }
        .buttonStyle(.borderedProminent)
        .disabled(checking || address.trimmingCharacters(in: .whitespaces).isEmpty)
        Text("connect.hint").font(.footnote).foregroundStyle(.secondary)
      }
      .padding(32)
      .frame(maxWidth: 560)
      .frame(maxWidth: .infinity)
    }
    .onAppear { if address.isEmpty { address = hub.lastAddress ?? "" } }
  }

  private func connect() {
    guard let url = HubAddress.normalize(address) else {
      problem = "connect.invalid"
      return
    }
    checking = true
    problem = nil
    Task {
      let result = await HubAddress.check(url)
      checking = false
      switch result {
      case .ok: hub.use(url)
      case .unreachable: problem = "connect.unreachable"
      case .untrustedCertificate: problem = "connect.untrusted"
      case .notAHub: problem = "connect.notAHub"
      }
    }
  }
}
