import Foundation

struct PhoneDialRequest: Encodable, Equatable {
    let contactId: String?
    let destinationNumber: String?
    let displayName: String?
    let callObjective: String
    let ownerAttestation: Bool?
    let saveContact: Bool?

    init(destinationNumber: String, callObjective: String) {
        contactId = nil
        self.destinationNumber = destinationNumber
        displayName = nil
        self.callObjective = callObjective
        ownerAttestation = nil
        saveContact = nil
    }

    /// Dials the Worker-configured verified recipient with a custom objective.
    init(verifiedRecipientObjective callObjective: String) {
        contactId = nil
        destinationNumber = nil
        displayName = nil
        self.callObjective = callObjective
        ownerAttestation = nil
        saveContact = nil
    }

    static func contact(id: String, objective: String) -> PhoneDialRequest {
        PhoneDialRequest(
            contactId: id,
            destinationNumber: nil,
            displayName: nil,
            callObjective: objective,
            ownerAttestation: nil,
            saveContact: nil
        )
    }

    static func newNumber(
        destinationNumber: String,
        displayName: String?,
        objective: String,
        attestation: Bool,
        saveContact: Bool
    ) -> PhoneDialRequest {
        PhoneDialRequest(
            contactId: nil,
            destinationNumber: destinationNumber,
            displayName: displayName,
            callObjective: objective,
            ownerAttestation: attestation,
            saveContact: saveContact
        )
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(callObjective, forKey: .callObjective)
        if let contactId {
            try container.encode(contactId, forKey: .contactId)
        }
        if let destinationNumber {
            try container.encode(destinationNumber, forKey: .destinationNumber)
        }
        if let displayName {
            try container.encode(displayName, forKey: .displayName)
        }
        if let ownerAttestation {
            try container.encode(ownerAttestation, forKey: .ownerAttestation)
        }
        if let saveContact {
            try container.encode(saveContact, forKey: .saveContact)
        }
    }

    private init(
        contactId: String?,
        destinationNumber: String?,
        displayName: String?,
        callObjective: String,
        ownerAttestation: Bool?,
        saveContact: Bool?
    ) {
        self.contactId = contactId
        self.destinationNumber = destinationNumber
        self.displayName = displayName
        self.callObjective = callObjective
        self.ownerAttestation = ownerAttestation
        self.saveContact = saveContact
    }

    private enum CodingKeys: String, CodingKey {
        case contactId
        case destinationNumber
        case displayName
        case callObjective
        case ownerAttestation
        case saveContact
    }
}

struct PhonePilotStartResponse: Decodable, Equatable {
    let leaseId: String
    let expiresAt: Double
    let status: String
    let maxCallSeconds: Int
}

struct PhonePilotCurrentResponse: Decodable, Equatable {
    let call: PhonePilotRecoveredCall?
}

struct PhonePilotRecoveredCall: Decodable, Equatable {
    let leaseId: String
    let expiresAt: Double
    let status: String
    let maxCallSeconds: Int
}

struct PhonePilotStatusResponse: Decodable, Equatable {
    let status: String
    let durationSeconds: Int?
    let priceUsd: Double?
    let priceUnit: String?
    let terminal: Bool
}

struct PhonePilotStopResponse: Decodable, Equatable {
    let stopped: Bool
    let status: String
}

struct PhonePilotCall: Equatable {
    let leaseId: String
    let expiresAt: Double
    let maxCallSeconds: Int
    private(set) var status: String
    private(set) var durationSeconds: Int?
    private(set) var priceUsd: Double?
    private(set) var priceUnit: String?
    private(set) var terminal: Bool

    init(start: PhonePilotStartResponse) {
        leaseId = start.leaseId
        expiresAt = start.expiresAt
        maxCallSeconds = start.maxCallSeconds
        status = start.status
        durationSeconds = nil
        priceUsd = nil
        priceUnit = nil
        terminal = false
    }

    init(recovered: PhonePilotRecoveredCall) {
        leaseId = recovered.leaseId
        expiresAt = recovered.expiresAt
        maxCallSeconds = recovered.maxCallSeconds
        status = recovered.status
        durationSeconds = nil
        priceUsd = nil
        priceUnit = nil
        terminal = false
    }

    var isActive: Bool {
        !terminal
    }

    mutating func apply(_ update: PhonePilotStatusResponse) {
        status = update.status
        durationSeconds = update.durationSeconds
        priceUsd = update.priceUsd
        priceUnit = update.priceUnit
        terminal = update.terminal
    }

    mutating func apply(_ update: PhonePilotStopResponse) {
        status = update.status
        terminal = update.stopped
    }
}
