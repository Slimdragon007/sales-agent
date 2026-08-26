import Foundation

struct PhoneContact: Decodable, Identifiable, Equatable {
    let id: String
    let displayName: String
    let e164: String
}

struct PhoneRecent: Decodable, Identifiable, Equatable {
    let id: String
    let leaseId: String
    let contactId: String?
    let displayName: String
    let e164: String
    let objective: String
    let status: String
    let outcome: String
    let startedAt: Int
    let endedAt: Int?
    let durationSeconds: Int?
    let summary: String?
    let transcriptStatus: String
    let providerCallSid: String?
    let updatedAt: Int
}
