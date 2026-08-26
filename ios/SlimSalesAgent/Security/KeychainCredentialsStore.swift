import Foundation
import Security

protocol CredentialsStoring {
    func load() throws -> PreviewCredentials?
    func save(_ credentials: PreviewCredentials) throws
    func delete() throws
}

struct KeychainCredentialsStore: CredentialsStoring {
    private let service = "ai.flowstateinc.slimsalesagent.preview"
    private let account = "owner-preview"

    func load() throws -> PreviewCredentials? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess, let data = result as? Data else {
            throw KeychainCredentialsError.unexpectedStatus(status)
        }

        do {
            return try JSONDecoder().decode(PreviewCredentials.self, from: data)
        } catch {
            throw KeychainCredentialsError.invalidStoredValue
        }
    }

    func save(_ credentials: PreviewCredentials) throws {
        let data = try JSONEncoder().encode(credentials)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]

        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainCredentialsError.unexpectedStatus(updateStatus)
        }

        var addQuery = baseQuery
        attributes.forEach { addQuery[$0.key] = $0.value }
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainCredentialsError.unexpectedStatus(addStatus)
        }
    }

    func delete() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainCredentialsError.unexpectedStatus(status)
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

enum KeychainCredentialsError: LocalizedError {
    case invalidStoredValue
    case unexpectedStatus(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidStoredValue:
            "The saved preview credential could not be read. Sign out and enter it again."
        case .unexpectedStatus:
            "The iPhone Keychain could not update the preview credential."
        }
    }
}
