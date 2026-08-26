import SwiftUI

struct ReadinessView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Live safety state")
                        .font(.largeTitle.bold())
                    Text("These values come from the secured Worker, not from editable settings on the phone.")
                        .foregroundStyle(.secondary)
                }

                if let safety = model.runtimeSafety {
                    spendCard(safety)
                    applicationLimitsCard(safety)
                    telephoneCard(safety)
                } else if model.isSignedIn && model.isRefreshing {
                    AgentCard {
                        HStack(spacing: 12) {
                            ProgressView()
                            Text("Reading Worker safety state…")
                                .foregroundStyle(.secondary)
                        }
                    }
                } else if model.isSignedIn {
                    AgentCard {
                        Text("Safety status is unavailable. Refresh before opening voice.")
                            .foregroundStyle(AppTheme.warning)
                    }
                } else {
                    OwnerSignInView()
                }

                if let errorMessage = model.errorMessage {
                    AgentCard {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(AppTheme.warning)
                    }
                }
            }
            .padding(20)
        }
        .background(AppTheme.background)
        .navigationTitle("Readiness")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.isSignedIn {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await model.refreshSafety() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(model.isRefreshing)
                }
            }
        }
    }

    private func spendCard(_ safety: RuntimeSafety) -> some View {
        AgentCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("Spend protection")
                        .font(.headline)
                    Spacer()
                    StatusPill(
                        text: safety.platformHardSpendLimit.confirmed ? "CONFIRMED" : "BLOCKED",
                        systemImage: safety.platformHardSpendLimit.confirmed ? "checkmark" : "xmark",
                        color: safety.platformHardSpendLimit.confirmed ? AppTheme.positive : AppTheme.warning
                    )
                }

                valueRow(
                    "Platform hard cap",
                    safety.platformHardSpendLimit.monthlyUsd.map {
                        $0.formatted(.currency(code: "USD")) + "/month"
                    } ?? "Missing"
                )
                valueRow("OpenAI API key", safety.apiKeyConfigured ? "Configured server-side" : "Missing")
                valueRow("Voice switch", safety.voiceEnabled ? "Enabled" : "Disabled")
            }
        }
    }

    private func applicationLimitsCard(_ safety: RuntimeSafety) -> some View {
        AgentCard {
            VStack(alignment: .leading, spacing: 14) {
                Text("Application limits")
                    .font(.headline)
                valueRow("Maximum role-play", "\(safety.limits.maxCallMinutes) minutes")
                valueRow(
                    "Paid tests today",
                    "\(safety.paidTestsToday) of \(safety.limits.maxDailyPaidTests)"
                )
                valueRow(
                    "Active sessions",
                    "\(safety.activeSessions) of \(safety.limits.maxConcurrentSessions)"
                )
            }
        }
    }

    private func telephoneCard(_ safety: RuntimeSafety) -> some View {
        AgentCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("Telephone pilot")
                        .font(.headline)
                    Spacer()
                    StatusPill(
                        text: safety.phonePilot.enabled ? "ENABLED" : "DISABLED",
                        systemImage: safety.phonePilot.enabled ? "phone.fill" : "phone.down.fill",
                        color: safety.phonePilot.enabled ? AppTheme.positive : AppTheme.warning
                    )
                }
                Text(
                    safety.phonePilot.enabled
                        ? "The authenticated iPhone control can place user-initiated calls to validated US and Canadian numbers."
                        : "The Worker safety switch is off, so every telephone call remains blocked."
                )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                valueRow(
                    "Maximum call",
                    "\(safety.phonePilot.maxCallMinutes) minutes"
                )
                valueRow(
                    "Concurrent calls",
                    "\(safety.phonePilotUsage.activeCalls) of \(safety.phonePilot.maxConcurrentCalls)"
                )
                valueRow(
                    "Lifetime pilot calls",
                    "\(safety.phonePilotUsage.lifetimeCalls) of \(safety.phonePilot.maxCalls)"
                )
                valueRow(
                    "Reserved pilot spend",
                    "\(safety.phonePilotUsage.estimatedReservedSpendUsd.formatted(.currency(code: "USD"))) of \(safety.phonePilot.maxEstimatedSpendUsd.formatted(.currency(code: "USD")))"
                )
                if let blockReason = safety.phonePilotBlockReason {
                    Label(blockReason, systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.warning)
                        .fixedSize(horizontal: false, vertical: true)
                }
                valueRow(
                    "Google Calendar",
                    calendarStatusLabel(safety.phonePilot.calendar)
                )
            }
        }
    }

    private func calendarStatusLabel(_ calendar: PhonePilotCalendar?) -> String {
        guard let calendar else {
            return "Status unknown"
        }

        if !calendar.enabled {
            return "Disabled"
        }

        switch calendar.connected {
        case true:
            return "Connected"
        case false:
            return "Not connected"
        case nil:
            return "Status unknown"
        }
    }

    private func valueRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
            Spacer()
            Text(value)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
        }
        .font(.subheadline)
    }
}
