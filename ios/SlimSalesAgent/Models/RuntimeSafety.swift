import Foundation

struct RuntimeSafety: Decodable, Equatable {
    let voiceEnabled: Bool
    let platformHardSpendLimit: PlatformHardSpendLimit
    let limits: ApplicationLimits
    let phonePilot: PhonePilot
    let apiKeyConfigured: Bool
    let activeSessions: Int
    let paidTestsToday: Int
    let realtimeModel: String
    let phonePilotUsage: PhonePilotUsage

    var canOpenVoiceWorkspace: Bool {
        voiceEnabled
            && platformHardSpendLimit.confirmed
            && platformHardSpendLimit.monthlyUsd != nil
            && apiKeyConfigured
            && activeSessions < limits.maxConcurrentSessions
            && paidTestsToday < limits.maxDailyPaidTests
    }

    var canStartPhonePilot: Bool {
        phonePilotBlockReason == nil
    }

    /// Human-readable reason dialing is blocked, or nil when ready.
    var phonePilotBlockReason: String? {
        if !phonePilot.enabled {
            return "Telephone dialing is locked by the Worker safety switch."
        }
        if !voiceEnabled {
            return "Voice is disabled on the Worker."
        }
        if !platformHardSpendLimit.confirmed || platformHardSpendLimit.monthlyUsd == nil {
            return "The OpenAI Platform hard spend limit is not confirmed."
        }
        if !apiKeyConfigured {
            return "The OpenAI API key is not configured on the Worker."
        }
        if phonePilotUsage.activeCalls >= phonePilot.maxConcurrentCalls {
            return "A telephone call is already active. End it before starting another."
        }
        if phonePilotUsage.lifetimeCalls >= phonePilot.maxCalls {
            return "Pilot call budget used (\(phonePilotUsage.lifetimeCalls) of \(phonePilot.maxCalls))."
        }
        let nextReserved =
            phonePilotUsage.estimatedReservedSpendUsd + phonePilot.reservedUsdPerCall
        if nextReserved > phonePilot.maxEstimatedSpendUsd {
            return "Pilot spend budget used (\(phonePilotUsage.estimatedReservedSpendUsd.formatted(.currency(code: "USD"))) of \(phonePilot.maxEstimatedSpendUsd.formatted(.currency(code: "USD"))) reserved). Raise maxEstimatedSpendUsd on the Worker to continue."
        }
        return nil
    }
}

struct PlatformHardSpendLimit: Decodable, Equatable {
    let confirmed: Bool
    let monthlyUsd: Double?
    let confirmedAt: String?
}

struct ApplicationLimits: Decodable, Equatable {
    let maxCallMinutes: Int
    let maxDailyPaidTests: Int
    let maxConcurrentSessions: Int
}

struct PhonePilot: Decodable, Equatable {
    let enabled: Bool
    let maxCalls: Int
    let maxCallMinutes: Int
    let maxConcurrentCalls: Int
    let maxEstimatedSpendUsd: Double
    let reservedUsdPerCall: Double
    let calendar: PhonePilotCalendar?
}

struct PhonePilotCalendar: Decodable, Equatable {
    let enabled: Bool
    let allowWrites: Bool
    let connected: Bool?
}

struct PhonePilotUsage: Decodable, Equatable {
    let activeCalls: Int
    let lifetimeCalls: Int
    let estimatedReservedSpendUsd: Double
}
