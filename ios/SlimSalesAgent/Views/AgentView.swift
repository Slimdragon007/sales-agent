import SwiftUI

struct AgentView: View {
    @Environment(AppModel.self) private var model
    @State private var callObjective =
        "Introduce yourself as the operator's AI assistant calling on their behalf. Confirm they can hear you, ask if now is a good time, and help with whatever the operator asked you to handle."
    @State private var showsNewNumberSheet = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Operator assistant")
                    .font(.largeTitle.bold())

                if model.isSignedIn {
                    PhonePilotCard(
                        callObjective: $callObjective,
                        onNewNumber: { showsNewNumberSheet = true }
                    )
                    PhoneRecentsSection()
                } else {
                    OwnerSignInView()
                }

                if let errorMessage = model.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.warning)
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(AppTheme.card, in: RoundedRectangle(cornerRadius: 16))
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 88)
        }
        .background(AppTheme.background)
        .navigationTitle("Phone")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showsNewNumberSheet) {
            PhoneNewNumberSheet(callObjective: $callObjective)
        }
        .toolbar {
            if model.isSignedIn {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await model.refreshPhoneAssistant() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(model.isRefreshing)
                    .accessibilityLabel("Refresh")
                }
            }
        }
    }
}
