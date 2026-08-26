import Foundation

struct PreviewCredentials: Codable, Equatable {
    let username: String
    let password: String

    init(username: String, password: String) throws {
        let normalizedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !normalizedUsername.isEmpty, !normalizedUsername.contains(":") else {
            throw PreviewCredentialsError.invalidUsername
        }
        guard !password.isEmpty else {
            throw PreviewCredentialsError.emptyPassword
        }

        self.username = normalizedUsername
        self.password = password
    }
}

enum PreviewCredentialsError: LocalizedError {
    case invalidUsername
    case emptyPassword

    var errorDescription: String? {
        switch self {
        case .invalidUsername:
            "Enter the preview username without a colon."
        case .emptyPassword:
            "Enter the private preview password."
        }
    }
}

enum AuthorizationHeader {
    static func basic(for credentials: PreviewCredentials) -> String {
        let value = "\(credentials.username):\(credentials.password)"
        let encoded = Data(value.utf8).base64EncodedString()
        return "Basic \(encoded)"
    }
}
