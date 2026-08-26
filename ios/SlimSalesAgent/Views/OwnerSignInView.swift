import SwiftUI

struct OwnerSignInView: View {
    @Environment(AppModel.self) private var model

    @State private var username = "operator"
    @State private var password = ""

    var body: some View {
        AgentCard {
            VStack(alignment: .leading, spacing: 16) {
                Image(systemName: "lock.shield.fill")
                    .font(.title2)
                    .foregroundStyle(AppTheme.accent)

                VStack(alignment: .leading, spacing: 6) {
                    Text("Owner access")
                        .font(.title3.weight(.semibold))
                    Text("Enter the same private-preview password you use in the browser. It stays in this iPhone's Keychain.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                TextField("Username", text: $username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textContentType(.username)
                    .padding(12)
                    .background(Color(uiColor: .systemBackground), in: RoundedRectangle(cornerRadius: 12))

                SecureField("Private preview password", text: $password)
                    .textContentType(.password)
                    .padding(12)
                    .background(Color(uiColor: .systemBackground), in: RoundedRectangle(cornerRadius: 12))

                Button {
                    Task {
                        await model.signIn(username: username, password: password)
                        if model.isSignedIn {
                            password = ""
                        }
                    }
                } label: {
                    HStack {
                        if model.isRefreshing {
                            ProgressView()
                                .tint(.white)
                        }
                        Text(model.isRefreshing ? "Checking access…" : "Unlock agent")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(model.isRefreshing || username.isEmpty || password.isEmpty)
            }
        }
    }
}
