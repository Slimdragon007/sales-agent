import Foundation

enum PhoneDisplay {
    static func maskedNumber(_ number: String) -> String {
        let digits = number.filter(\.isNumber)
        guard digits.count >= 4 else {
            return number
        }

        let countryCode = number.trimmingCharacters(in: .whitespacesAndNewlines)
            .hasPrefix("+1") ? "+1" : "+"
        return "\(countryCode) ··· \(digits.suffix(4))"
    }
}
