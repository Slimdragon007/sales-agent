import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Form {
            if model.isSignedIn {
                Section("Owner access") {
                    LabeledContent("Username", value: model.credentials?.username ?? "Owner")
                    LabeledContent("Credential storage", value: "iPhone Keychain")
                    LabeledContent("Service", value: model.workerBaseURL.host ?? "Private")
                }

                Section("Status") {
                    Button {
                        Task { await model.refreshSafety() }
                    } label: {
                        Label(
                            model.isRefreshing ? "Refreshing…" : "Refresh safety state",
                            systemImage: "arrow.clockwise"
                        )
                    }
                    .disabled(model.isRefreshing)
                }

                Section {
                    Button("Sign out and remove saved credential", role: .destructive) {
                        model.signOut()
                    }
                    .disabled(
                        model.isPhonePilotBusy
                            || model.hasActivePhonePilotCall
                    )
                } footer: {
                    Text(
                        model.isPhonePilotBusy
                            || model.hasActivePhonePilotCall
                            ? "End the telephone call before signing out so its stop control remains available."
                            : "Signing out removes the private-preview credential from this iPhone. It does not change remote access settings."
                    )
                }
            } else {
                Section {
                    OwnerSignInView()
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
            }

            Section("Safety") {
                LabeledContent("Permanent API keys", value: "Cloudflare only")
                LabeledContent(
                    "Telephone dialing",
                    value: model.runtimeSafety?.phonePilot.enabled == true
                        ? "Owner dialer enabled"
                        : "Protected pilot locked"
                )
                LabeledContent("Outreach sending", value: "Not implemented")
            }

            Section("Browser role-play") {
                Text(
                    "Prospect simulation and paid browser voice stay on the private web experience. This iPhone app is the phone agent only."
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
                if let host = model.workerBaseURL.host {
                    LabeledContent("Service host", value: host)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
    }
}
