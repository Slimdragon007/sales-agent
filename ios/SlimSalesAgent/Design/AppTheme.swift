import SwiftUI

enum AppTheme {
    static let accent = Color(red: 0.18, green: 0.42, blue: 0.96)
    static let background = Color(uiColor: .systemGroupedBackground)
    static let card = Color(uiColor: .secondarySystemGroupedBackground)
    static let border = Color.black.opacity(0.08)
    static let positive = Color(red: 0.08, green: 0.55, blue: 0.36)
    static let warning = Color(red: 0.78, green: 0.42, blue: 0.05)
}

struct AgentCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)
            .background(AppTheme.card, in: RoundedRectangle(cornerRadius: 20))
            .overlay {
                RoundedRectangle(cornerRadius: 20)
                    .stroke(AppTheme.border, lineWidth: 1)
            }
    }
}

struct StatusPill: View {
    let text: String
    let systemImage: String
    let color: Color

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.caption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(color.opacity(0.1), in: Capsule())
    }
}
