import SwiftUI

struct PhoneNewNumberSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @Binding var callObjective: String
    @State private var destinationNumber = ""
    @State private var displayName = ""
    @State private var ownerAttestation = false
    @State private var saveContact = false
    @State private var showsConfirmation = false

    private var trimmedNumber: String {
        destinationNumber.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedName: String {
        displayName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedObjective: String {
        callObjective.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canPlaceCall: Bool {
        model.canStartPhonePilot
            && !model.isPhonePilotBusy
            && trimmedNumber.count >= 7
            && trimmedObjective.count >= 10
            && ownerAttestation
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Phone number", text: $destinationNumber)
                        .textContentType(.telephoneNumber)
                        .keyboardType(.phonePad)
                    TextField("Name (optional)", text: $displayName)
                        .textContentType(.name)
                    Toggle("Save as a person after calling", isOn: $saveContact)
                } header: {
                    Text("Number")
                } footer: {
                    Text("Use a number you are allowed to contact. Include country code when possible.")
                }

                Section {
                    Toggle(isOn: $ownerAttestation) {
                        Text(
                            "I have permission to call this number with the operator's disclosed AI assistant."
                        )
                    }
                } header: {
                    Text("Owner attestation")
                } footer: {
                    Text("This must be on before Place call is enabled.")
                }

                Section {
                    Button {
                        showsConfirmation = true
                    } label: {
                        HStack {
                            if model.isPhonePilotBusy {
                                ProgressView()
                            }
                            Label("Place call", systemImage: "phone.fill")
                        }
                    }
                    .disabled(!canPlaceCall)
                } footer: {
                    if trimmedObjective.count < 10 {
                        Text("Write the call task on the Phone tab before placing a call.")
                    } else if !ownerAttestation {
                        Text("Turn on the owner attestation to continue.")
                    } else if !model.canStartPhonePilot {
                        Text("Calling is currently locked by safety settings.")
                    }
                }

                if let errorMessage = model.phonePilotErrorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(AppTheme.warning)
                    }
                }
            }
            .navigationTitle("New number")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(model.isPhonePilotBusy)
                }
            }
            .confirmationDialog(
                "Place this paid AI phone call?",
                isPresented: $showsConfirmation,
                titleVisibility: .visible
            ) {
                Button("Place call now") {
                    Task {
                        await model.startPhonePilotNewNumber(
                            destinationNumber: trimmedNumber,
                            displayName: trimmedName.isEmpty ? nil : trimmedName,
                            callObjective: trimmedObjective,
                            saveContact: saveContact
                        )
                        if model.hasActivePhonePilotCall {
                            dismiss()
                        }
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(
                    "AI assistant for the operator · \(PhoneDisplay.maskedNumber(trimmedNumber)) · max \(model.runtimeSafety?.phonePilot.maxCallMinutes ?? 5) min"
                )
            }
        }
    }
}
