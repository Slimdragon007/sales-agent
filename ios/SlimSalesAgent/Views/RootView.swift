import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        TabView {
            NavigationStack {
                AgentView()
            }
            .tabItem {
                Label("Phone", systemImage: "phone.fill")
            }

            NavigationStack {
                ReadinessView()
            }
            .tabItem {
                Label("Readiness", systemImage: "checkmark.shield")
            }

            NavigationStack {
                SettingsView()
            }
            .tabItem {
                Label("Settings", systemImage: "gearshape")
            }
        }
        .task {
            await model.restoreSession()
        }
    }
}

#Preview {
    RootView()
        .environment(
            AppModel(
                workerBaseURL: URL(string: "https://example.com")!,
                credentialsStore: PreviewCredentialsStore()
            )
        )
        .preferredColorScheme(.light)
}

private struct PreviewCredentialsStore: CredentialsStoring {
    func load() throws -> PreviewCredentials? { nil }
    func save(_ credentials: PreviewCredentials) throws {}
    func delete() throws {}
}
