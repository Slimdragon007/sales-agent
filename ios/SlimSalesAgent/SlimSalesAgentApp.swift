import SwiftUI

@main
struct SlimSalesAgentApp: App {
    @State private var model: AppModel

    init() {
        _model = State(
            initialValue: AppModel(
                workerBaseURL: AppConfiguration.workerBaseURL,
                credentialsStore: KeychainCredentialsStore()
            )
        )
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(AppTheme.accent)
                .preferredColorScheme(.light)
        }
    }
}
