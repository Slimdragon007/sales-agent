import SwiftUI

struct PhonePilotCard: View {
    @Environment(AppModel.self) private var model
    @Binding var callObjective: String
    let onNewNumber: () -> Void

    @State private var showsCallConfirmation = false
    @FocusState private var objectiveFocused: Bool

    private var activeCall: Bool {
        model.phonePilotCall?.isActive == true
    }

    private var selectedContact: PhoneContact? {
        model.contacts.first { $0.id == model.selectedContactId }
    }

    private var trimmedObjective: String {
        callObjective.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canPlaceContactCall: Bool {
        model.canStartPhonePilot
            && selectedContact != nil
            && trimmedObjective.count >= 10
            && !model.isPhonePilotBusy
    }

    private var dialBlockReason: String? {
        guard !activeCall else {
            return nil
        }
        if !model.canStartPhonePilot {
            return model.runtimeSafety?.phonePilotBlockReason
                ?? "Calling is locked right now."
        }
        if model.contacts.isEmpty {
            return nil
        }
        if selectedContact == nil {
            return "Choose who to call."
        }
        if trimmedObjective.count < 10 {
            return "Add a short task for the assistant."
        }
        return nil
    }

    var body: some View {
        AgentCard {
            VStack(alignment: .leading, spacing: 18) {
                if activeCall, let call = model.phonePilotCall {
                    activeCallBlock(call)
                } else {
                    whoSection
                    objectiveField
                    if let dialBlockReason {
                        Text(dialBlockReason)
                            .font(.subheadline)
                            .foregroundStyle(AppTheme.warning)
                    }
                }

                primaryCallControls

                if let errorMessage = model.phonePilotErrorMessage {
                    Text(errorMessage)
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.warning)
                }
            }
        }
        .confirmationDialog(
            selectedContact.map { "Call \($0.displayName)?" }
                ?? "Place this call?",
            isPresented: $showsCallConfirmation,
            titleVisibility: .visible
        ) {
            Button("Place call") {
                Task {
                    guard let selectedContact else {
                        return
                    }
                    await model.startPhonePilotContact(
                        contactId: selectedContact.id,
                        callObjective: trimmedObjective
                    )
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                "AI assistant for the operator · \(PhoneDisplay.maskedNumber(selectedContact?.e164 ?? "")) · max \(model.runtimeSafety?.phonePilot.maxCallMinutes ?? 5) min"
            )
        }
        .task(id: model.phonePilotCall?.leaseId) {
            guard model.hasActivePhonePilotCall else {
                return
            }
            await model.monitorPhonePilotCall()
        }
    }

    private var whoSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Who")
                    .font(.headline)
                Spacer()
                Button("New number", action: onNewNumber)
                    .font(.subheadline.weight(.semibold))
                    .disabled(model.hasActivePhonePilotCall || model.isPhonePilotBusy)
            }

            if model.contacts.isEmpty {
                Text(
                    model.isRefreshing
                        ? "Loading…"
                        : "No saved people yet. Use New number."
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(model.contacts) { contact in
                            personChip(contact)
                        }
                    }
                }
            }
        }
    }

    private func personChip(_ contact: PhoneContact) -> some View {
        let selected = contact.id == model.selectedContactId

        return Button {
            model.selectedContactId = contact.id
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(contact.displayName)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Text(PhoneDisplay.maskedNumber(contact.e164))
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(selected ? Color.white.opacity(0.85) : .secondary)
            }
            .foregroundStyle(selected ? Color.white : Color.primary)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                selected ? AppTheme.accent : Color(uiColor: .tertiarySystemGroupedBackground),
                in: Capsule()
            )
        }
        .buttonStyle(.plain)
        .disabled(model.hasActivePhonePilotCall || model.isPhonePilotBusy)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityLabel("\(contact.displayName), \(contact.e164)")
    }

    private var objectiveField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Task")
                .font(.headline)
            TextEditor(text: $callObjective)
                .frame(minHeight: 110)
                .padding(10)
                .scrollContentBackground(.hidden)
                .background(
                    Color(uiColor: .tertiarySystemGroupedBackground),
                    in: RoundedRectangle(cornerRadius: 12)
                )
                .focused($objectiveFocused)
                .accessibilityLabel("Call task")
                .onChange(of: callObjective) { _, updatedValue in
                    if updatedValue.count > 1_200 {
                        callObjective = String(updatedValue.prefix(1_200))
                    }
                }
                .disabled(!model.canStartPhonePilot || model.isPhonePilotBusy)
        }
    }

    @ViewBuilder
    private var primaryCallControls: some View {
        if activeCall {
            Button(role: .destructive) {
                Task { await model.stopPhonePilot() }
            } label: {
                Label(
                    model.isPhonePilotBusy ? "Ending…" : "End call",
                    systemImage: "phone.down.fill"
                )
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .disabled(model.isPhonePilotBusy)
        } else {
            Button {
                objectiveFocused = false
                showsCallConfirmation = true
            } label: {
                Label(placeCallLabel, systemImage: "phone.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!canPlaceContactCall)
        }
    }

    private var placeCallLabel: String {
        if model.isPhonePilotBusy {
            return "Starting…"
        }
        if let selectedContact {
            return "Call \(selectedContact.displayName)"
        }
        return "Call"
    }

    @ViewBuilder
    private func activeCallBlock(_ call: PhonePilotCall) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(selectedContact?.displayName ?? "Call in progress")
                .font(.title3.weight(.semibold))
            Text(call.status.replacingOccurrences(of: "-", with: " ").localizedCapitalized)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let durationSeconds = call.durationSeconds {
                Text("\(durationSeconds)s")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
