import XCTest
@testable import SlimSalesAgent

final class RuntimeSafetyTests: XCTestCase {
    func testDecodesCurrentWorkerPayloadAndUnlocksWorkspace() throws {
        let data = Data(
            """
            {
              "voiceEnabled": true,
              "platformHardSpendLimit": {
                "confirmed": true,
                "monthlyUsd": 10,
                "confirmedAt": "2026-07-29T00:00:00.000Z"
              },
              "limits": {
                "maxCallMinutes": 15,
                "maxDailyPaidTests": 10,
                "maxConcurrentSessions": 1
              },
              "phonePilot": {
                "enabled": false,
                "maxCalls": 5,
                "maxCallMinutes": 5,
                "maxConcurrentCalls": 1,
                "maxEstimatedSpendUsd": 5,
                "reservedUsdPerCall": 1
              },
              "apiKeyConfigured": true,
              "activeSessions": 0,
              "paidTestsToday": 0,
              "realtimeModel": "gpt-realtime",
              "phonePilotUsage": {
                "activeCalls": 0,
                "lifetimeCalls": 0,
                "estimatedReservedSpendUsd": 0
              }
            }
            """.utf8
        )

        let safety = try JSONDecoder().decode(RuntimeSafety.self, from: data)

        XCTAssertTrue(safety.canOpenVoiceWorkspace)
        XCTAssertFalse(safety.phonePilot.enabled)
        XCTAssertEqual(safety.platformHardSpendLimit.monthlyUsd, 10)
    }

    func testDecodesGoogleCalendarConnectionFromWorkerPayload() throws {
        let data = Data(
            """
            {
              "voiceEnabled": true,
              "platformHardSpendLimit": {
                "confirmed": true,
                "monthlyUsd": 10,
                "confirmedAt": "2026-07-29T00:00:00.000Z"
              },
              "limits": {
                "maxCallMinutes": 15,
                "maxDailyPaidTests": 10,
                "maxConcurrentSessions": 1
              },
              "phonePilot": {
                "enabled": true,
                "maxCalls": 5,
                "maxCallMinutes": 5,
                "maxConcurrentCalls": 1,
                "maxEstimatedSpendUsd": 5,
                "reservedUsdPerCall": 1,
                "calendar": {
                  "enabled": true,
                  "allowWrites": true,
                  "connected": true
                }
              },
              "apiKeyConfigured": true,
              "activeSessions": 0,
              "paidTestsToday": 0,
              "realtimeModel": "gpt-realtime",
              "phonePilotUsage": {
                "activeCalls": 0,
                "lifetimeCalls": 0,
                "estimatedReservedSpendUsd": 0
              }
            }
            """.utf8
        )

        let safety = try JSONDecoder().decode(RuntimeSafety.self, from: data)

        XCTAssertEqual(safety.phonePilot.calendar?.enabled, true)
        XCTAssertEqual(safety.phonePilot.calendar?.allowWrites, true)
        XCTAssertEqual(safety.phonePilot.calendar?.connected, true)
        XCTAssertTrue(safety.canStartPhonePilot)
    }

    func testWorkspaceStaysLockedWhenDailyLimitIsReached() {
        let safety = RuntimeSafety(
            voiceEnabled: true,
            platformHardSpendLimit: PlatformHardSpendLimit(
                confirmed: true,
                monthlyUsd: 10,
                confirmedAt: nil
            ),
            limits: ApplicationLimits(
                maxCallMinutes: 15,
                maxDailyPaidTests: 10,
                maxConcurrentSessions: 1
            ),
            phonePilot: PhonePilot(
                enabled: false,
                maxCalls: 5,
                maxCallMinutes: 5,
                maxConcurrentCalls: 1,
                maxEstimatedSpendUsd: 5,
                reservedUsdPerCall: 1,
                calendar: nil
            ),
            apiKeyConfigured: true,
            activeSessions: 0,
            paidTestsToday: 10,
            realtimeModel: "gpt-realtime",
            phonePilotUsage: PhonePilotUsage(
                activeCalls: 0,
                lifetimeCalls: 0,
                estimatedReservedSpendUsd: 0
            )
        )

        XCTAssertFalse(safety.canOpenVoiceWorkspace)
    }

    func testPhonePilotRequiresTheServerSwitchAndEveryUsageGate() {
        let locked = phoneReadySafety(
            phonePilot: PhonePilot(
                enabled: false,
                maxCalls: 5,
                maxCallMinutes: 5,
                maxConcurrentCalls: 1,
                maxEstimatedSpendUsd: 5,
                reservedUsdPerCall: 1,
                calendar: nil
            )
        )
        XCTAssertFalse(locked.canStartPhonePilot)
        XCTAssertEqual(
            locked.phonePilotBlockReason,
            "Telephone dialing is locked by the Worker safety switch."
        )

        let enabled = phoneReadySafety(
            phonePilot: PhonePilot(
                enabled: true,
                maxCalls: 5,
                maxCallMinutes: 5,
                maxConcurrentCalls: 1,
                maxEstimatedSpendUsd: 5,
                reservedUsdPerCall: 1,
                calendar: nil
            )
        )
        XCTAssertTrue(enabled.canStartPhonePilot)
        XCTAssertNil(enabled.phonePilotBlockReason)

        let concurrencyReached = phoneReadySafety(
            phonePilot: enabled.phonePilot,
            usage: PhonePilotUsage(
                activeCalls: 1,
                lifetimeCalls: 1,
                estimatedReservedSpendUsd: 1
            )
        )
        XCTAssertFalse(concurrencyReached.canStartPhonePilot)
        XCTAssertEqual(
            concurrencyReached.phonePilotBlockReason,
            "A telephone call is already active. End it before starting another."
        )

        let lifetimeReached = phoneReadySafety(
            phonePilot: enabled.phonePilot,
            usage: PhonePilotUsage(
                activeCalls: 0,
                lifetimeCalls: 5,
                estimatedReservedSpendUsd: 5
            )
        )
        XCTAssertFalse(lifetimeReached.canStartPhonePilot)
        XCTAssertEqual(
            lifetimeReached.phonePilotBlockReason,
            "Pilot call budget used (5 of 5)."
        )

        let spendReached = phoneReadySafety(
            phonePilot: enabled.phonePilot,
            usage: PhonePilotUsage(
                activeCalls: 0,
                lifetimeCalls: 2,
                estimatedReservedSpendUsd: 5
            )
        )
        XCTAssertFalse(spendReached.canStartPhonePilot)
        XCTAssertTrue(
            spendReached.phonePilotBlockReason?
                .contains("Pilot spend budget used") == true
        )
    }

    private func phoneReadySafety(
        phonePilot: PhonePilot,
        usage: PhonePilotUsage = PhonePilotUsage(
            activeCalls: 0,
            lifetimeCalls: 0,
            estimatedReservedSpendUsd: 0
        )
    ) -> RuntimeSafety {
        RuntimeSafety(
            voiceEnabled: true,
            platformHardSpendLimit: PlatformHardSpendLimit(
                confirmed: true,
                monthlyUsd: 10,
                confirmedAt: nil
            ),
            limits: ApplicationLimits(
                maxCallMinutes: 15,
                maxDailyPaidTests: 10,
                maxConcurrentSessions: 1
            ),
            phonePilot: phonePilot,
            apiKeyConfigured: true,
            activeSessions: 0,
            paidTestsToday: 0,
            realtimeModel: "gpt-realtime-2.1",
            phonePilotUsage: usage
        )
    }
}
