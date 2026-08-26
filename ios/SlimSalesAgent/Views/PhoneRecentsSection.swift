import SwiftUI

struct PhoneRecentsSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recents")
                .font(.headline)
                .padding(.horizontal, 4)

            if model.recents.isEmpty {
                Text("No calls yet")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 4)
            } else {
                AgentCard {
                    VStack(spacing: 0) {
                        let visible = Array(model.recents.prefix(10))
                        ForEach(visible.indices, id: \.self) { index in
                            recentRow(visible[index])
                            if index < visible.count - 1 {
                                Divider().padding(.leading, 36)
                            }
                        }
                    }
                }
            }
        }
    }

    private func recentRow(_ recent: PhoneRecent) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: iconName(for: recent))
                .foregroundStyle(color(for: recent))
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(recent.displayName)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    Spacer()
                    Text(startedAtLabel(recent.startedAt))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Text(readableStatus(recent.outcome.isEmpty ? recent.status : recent.outcome))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(color(for: recent))

                Text(recent.objective)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 10)
    }

    private func iconName(for recent: PhoneRecent) -> String {
        switch recent.outcome {
        case "completed":
            return "phone.fill"
        case "failed", "canceled", "cancelled":
            return "phone.down.fill"
        default:
            return "phone"
        }
    }

    private func color(for recent: PhoneRecent) -> Color {
        switch recent.outcome {
        case "completed":
            return AppTheme.positive
        case "failed", "canceled", "cancelled":
            return AppTheme.warning
        default:
            return AppTheme.accent
        }
    }

    private func startedAtLabel(_ epoch: Int) -> String {
        let seconds = epoch > 10_000_000_000
            ? TimeInterval(epoch) / 1_000
            : TimeInterval(epoch)
        return Date(timeIntervalSince1970: seconds).formatted(
            .relative(presentation: .named)
        )
    }

    private func readableStatus(_ status: String) -> String {
        status.replacingOccurrences(of: "-", with: " ").localizedCapitalized
    }
}
