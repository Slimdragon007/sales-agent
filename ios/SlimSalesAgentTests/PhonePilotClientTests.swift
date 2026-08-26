import XCTest
@testable import SlimSalesAgent

final class PhonePilotClientTests: XCTestCase {
    private let baseURL = URL(string: "https://agent.example.com")!

    func testStartByContactIdOmitsDestinationNumber() throws {
        let body = try JSONEncoder().encode(
            PhoneDialRequest.contact(
                id: "c-primary",
                objective: "Ask whether Tuesday morning appointments are available."
            )
        )

        let payload = try XCTUnwrap(
            JSONSerialization.jsonObject(with: body) as? [String: Any]
        )
        XCTAssertEqual(payload["contactId"] as? String, "c-primary")
        XCTAssertEqual(
            payload["callObjective"] as? String,
            "Ask whether Tuesday morning appointments are available."
        )
        XCTAssertNil(payload["destinationNumber"])
        XCTAssertNil(payload["ownerAttestation"])
    }

    func testStartNewNumberSendsOwnerAttestationAndSavePreference() async throws {
        let credentials = try PreviewCredentials(
            username: "operator",
            password: "private"
        )
        let recorder = PhonePilotRequestRecorder()
        let responseData = Data(
            """
            {
              "leaseId": "new-number-lease",
              "expiresAt": 123456789,
              "status": "queued",
              "maxCallSeconds": 300
            }
            """.utf8
        )
        let client = PhonePilotClient { request in
            await recorder.capture(request)
            return (
                responseData,
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 201,
                    httpVersion: nil,
                    headerFields: nil
                )!
            )
        }

        let start = try await client.startNewNumber(
            baseURL: baseURL,
            credentials: credentials,
            destinationNumber: "480-555-0102",
            displayName: "Primary",
            callObjective: "Ask whether Tuesday morning appointments are available.",
            saveContact: true
        )
        let capturedRequest = await recorder.request

        XCTAssertEqual(start.leaseId, "new-number-lease")
        XCTAssertEqual(capturedRequest?.url?.path, "/api/phone-pilot/start")
        let body = try XCTUnwrap(capturedRequest?.httpBody)
        let payload = try XCTUnwrap(
            JSONSerialization.jsonObject(with: body) as? [String: Any]
        )
        XCTAssertEqual(payload["destinationNumber"] as? String, "480-555-0102")
        XCTAssertEqual(payload["displayName"] as? String, "Primary")
        XCTAssertEqual(
            payload["callObjective"] as? String,
            "Ask whether Tuesday morning appointments are available."
        )
        XCTAssertEqual(payload["ownerAttestation"] as? Bool, true)
        XCTAssertEqual(payload["saveContact"] as? Bool, true)
        XCTAssertNil(payload["contactId"])
    }

    func testListContactsUsesAuthenticatedOwnerGETAndDecodesContacts() async throws {
        let credentials = try PreviewCredentials(
            username: "operator",
            password: "private"
        )
        let recorder = PhonePilotRequestRecorder()
        let responseData = Data(
            """
            {
              "contacts": [
                {
                  "id": "c-primary",
                  "displayName": "Primary",
                  "e164": "+14805550102"
                }
              ]
            }
            """.utf8
        )
        let client = PhonePilotClient { request in
            await recorder.capture(request)
            return (
                responseData,
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: nil
                )!
            )
        }

        let contacts = try await client.listContacts(
            baseURL: baseURL,
            credentials: credentials
        )
        let capturedRequest = await recorder.request

        XCTAssertEqual(
            contacts,
            [
                PhoneContact(
                    id: "c-primary",
                    displayName: "Primary",
                    e164: "+14805550102"
                ),
            ]
        )
        XCTAssertEqual(capturedRequest?.httpMethod, "GET")
        XCTAssertEqual(
            capturedRequest?.url?.path,
            "/api/phone-pilot/contacts"
        )
        XCTAssertEqual(
            capturedRequest?.value(forHTTPHeaderField: "Authorization"),
            AuthorizationHeader.basic(for: credentials)
        )
        XCTAssertEqual(
            capturedRequest?.value(
                forHTTPHeaderField: "X-Slim-Request-Intent"
            ),
            "owner-ui-v1"
        )
    }

    func testListRecentsUsesAuthenticatedOwnerGETAndDecodesHistory() async throws {
        let credentials = try PreviewCredentials(
            username: "operator",
            password: "private"
        )
        let recorder = PhonePilotRequestRecorder()
        let responseData = Data(
            """
            {
              "recents": [
                {
                  "id": "h-1",
                  "leaseId": "lease-1",
                  "contactId": "c-primary",
                  "displayName": "Primary",
                  "e164": "+14805550102",
                  "objective": "Ask whether Tuesday morning appointments are available.",
                  "status": "completed",
                  "outcome": "completed",
                  "startedAt": 123456000,
                  "endedAt": 123498000,
                  "durationSeconds": 42,
                  "summary": "The contact asked for a follow-up.",
                  "transcriptStatus": "ready",
                  "providerCallSid": "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  "updatedAt": 123499000
                }
              ]
            }
            """.utf8
        )
        let client = PhonePilotClient { request in
            await recorder.capture(request)
            return (
                responseData,
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: nil
                )!
            )
        }

        let recents = try await client.listRecents(
            baseURL: baseURL,
            credentials: credentials
        )
        let capturedRequest = await recorder.request

        XCTAssertEqual(recents.count, 1)
        XCTAssertEqual(recents.first?.id, "h-1")
        XCTAssertEqual(recents.first?.leaseId, "lease-1")
        XCTAssertEqual(recents.first?.contactId, "c-primary")
        XCTAssertEqual(recents.first?.durationSeconds, 42)
        XCTAssertEqual(recents.first?.summary, "The contact asked for a follow-up.")
        XCTAssertEqual(capturedRequest?.httpMethod, "GET")
        XCTAssertEqual(
            capturedRequest?.url?.path,
            "/api/phone-pilot/recents"
        )
        XCTAssertEqual(
            capturedRequest?.value(forHTTPHeaderField: "Authorization"),
            AuthorizationHeader.basic(for: credentials)
        )
    }

    func testStartSendsOwnerIntentDestinationAndObjective() async throws {
        let credentials = try PreviewCredentials(
            username: "operator",
            password: "private"
        )
        let recorder = PhonePilotRequestRecorder()
        let responseData = Data(
            """
            {
              "leaseId": "test-lease",
              "expiresAt": 123456789,
              "status": "queued",
              "maxCallSeconds": 300
            }
            """.utf8
        )
        let client = PhonePilotClient { request in
            await recorder.capture(request)
            return (
                responseData,
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 201,
                    httpVersion: nil,
                    headerFields: nil
                )!
            )
        }

        let start = try await client.start(
            baseURL: baseURL,
            credentials: credentials,
            dialRequest: PhoneDialRequest(
                destinationNumber: "480-555-0102",
                callObjective: "Ask whether Tuesday morning appointments are available."
            )
        )
        let capturedRequest = await recorder.request

        XCTAssertEqual(start.status, "queued")
        XCTAssertEqual(start.maxCallSeconds, 300)
        XCTAssertEqual(
            capturedRequest?.url?.path,
            "/api/phone-pilot/start"
        )
        XCTAssertEqual(capturedRequest?.httpMethod, "POST")
        XCTAssertEqual(
            capturedRequest?.value(
                forHTTPHeaderField: "X-Slim-Request-Intent"
            ),
            "owner-ui-v1"
        )
        XCTAssertEqual(
            capturedRequest?.value(forHTTPHeaderField: "Authorization"),
            AuthorizationHeader.basic(for: credentials)
        )
        let body = try XCTUnwrap(capturedRequest?.httpBody)
        let payload = try XCTUnwrap(
            JSONSerialization.jsonObject(with: body) as? [String: String]
        )
        XCTAssertEqual(
            payload,
            [
                "destinationNumber": "480-555-0102",
                "callObjective": "Ask whether Tuesday morning appointments are available.",
            ]
        )
    }

    func testStartVerifiedOmitsDestinationAndSendsObjective() async throws {
        let credentials = try PreviewCredentials(
            username: "operator",
            password: "private"
        )
        let recorder = PhonePilotRequestRecorder()
        let responseData = Data(
            """
            {
              "leaseId": "verified-lease",
              "expiresAt": 123456789,
              "status": "queued",
              "maxCallSeconds": 300
            }
            """.utf8
        )
        let client = PhonePilotClient { request in
            await recorder.capture(request)
            return (
                responseData,
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 201,
                    httpVersion: nil,
                    headerFields: nil
                )!
            )
        }

        _ = try await client.startVerified(
            baseURL: baseURL,
            credentials: credentials,
            callObjective: "Take a message for the operator about Tuesday."
        )
        let capturedRequest = await recorder.request
        let body = try XCTUnwrap(capturedRequest?.httpBody)
        let payload = try XCTUnwrap(
            JSONSerialization.jsonObject(with: body) as? [String: String]
        )
        XCTAssertEqual(
            payload,
            [
                "callObjective": "Take a message for the operator about Tuesday.",
            ]
        )
        XCTAssertNil(payload["destinationNumber"])
    }

    func testStartSelfTestSendsEmptyBodyWithoutDestination() async throws {
        let credentials = try PreviewCredentials(
            username: "operator",
            password: "private"
        )
        let recorder = PhonePilotRequestRecorder()
        let responseData = Data(
            """
            {
              "leaseId": "self-test-lease",
              "expiresAt": 123456789,
              "status": "queued",
              "maxCallSeconds": 300
            }
            """.utf8
        )
        let client = PhonePilotClient { request in
            await recorder.capture(request)
            return (
                responseData,
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 201,
                    httpVersion: nil,
                    headerFields: nil
                )!
            )
        }

        let start = try await client.startSelfTest(
            baseURL: baseURL,
            credentials: credentials
        )
        let capturedRequest = await recorder.request

        XCTAssertEqual(start.leaseId, "self-test-lease")
        XCTAssertEqual(
            capturedRequest?.url?.path,
            "/api/phone-pilot/start"
        )
        XCTAssertEqual(capturedRequest?.httpMethod, "POST")
        XCTAssertEqual(
            capturedRequest?.value(
                forHTTPHeaderField: "X-Slim-Request-Intent"
            ),
            "owner-ui-v1"
        )
        XCTAssertNil(
            capturedRequest?.value(forHTTPHeaderField: "Content-Type")
        )
        XCTAssertEqual(capturedRequest?.httpBody, Data())
    }

    func testStatusSendsOnlyTheSafetyLeaseAndDecodesCarrierCost() async throws {
        let credentials = try PreviewCredentials(
            username: "operator",
            password: "private"
        )
        let recorder = PhonePilotRequestRecorder()
        let responseData = Data(
            """
            {
              "status": "completed",
              "durationSeconds": 42,
              "priceUsd": 0.03,
              "priceUnit": "USD",
              "terminal": true
            }
            """.utf8
        )
        let client = PhonePilotClient { request in
            await recorder.capture(request)
            return (
                responseData,
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: nil
                )!
            )
        }

        let status = try await client.status(
            baseURL: baseURL,
            credentials: credentials,
            leaseId: "test-lease"
        )
        let capturedRequest = await recorder.request

        XCTAssertTrue(status.terminal)
        XCTAssertEqual(status.priceUsd, 0.03)
        XCTAssertEqual(
            capturedRequest?.url?.path,
            "/api/phone-pilot/status"
        )

        let body = try XCTUnwrap(capturedRequest?.httpBody)
        let payload = try XCTUnwrap(
            JSONSerialization.jsonObject(with: body) as? [String: String]
        )
        XCTAssertEqual(payload, ["leaseId": "test-lease"])
    }

    func testCurrentCallRecoveryUsesAuthenticatedOwnerGET() async throws {
        let credentials = try PreviewCredentials(
            username: "operator",
            password: "private"
        )
        let recorder = PhonePilotRequestRecorder()
        let responseData = Data(
            """
            {
              "call": {
                "leaseId": "recovered-lease",
                "expiresAt": 123456789,
                "status": "in-progress",
                "maxCallSeconds": 300
              }
            }
            """.utf8
        )
        let client = PhonePilotClient { request in
            await recorder.capture(request)
            return (
                responseData,
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: nil
                )!
            )
        }

        let current = try await client.current(
            baseURL: baseURL,
            credentials: credentials
        )
        let capturedRequest = await recorder.request

        XCTAssertEqual(current.call?.leaseId, "recovered-lease")
        XCTAssertEqual(capturedRequest?.httpMethod, "GET")
        XCTAssertEqual(
            capturedRequest?.url?.path,
            "/api/phone-pilot/current"
        )
        XCTAssertEqual(
            capturedRequest?.value(forHTTPHeaderField: "Authorization"),
            AuthorizationHeader.basic(for: credentials)
        )
    }

    func testDisabledPilotMessageIsPreserved() async throws {
        let credentials = try PreviewCredentials(
            username: "operator",
            password: "private"
        )
        let client = PhonePilotClient { request in
            (
                Data(
                    """
                    {
                      "code": "PHONE_PILOT_DISABLED",
                      "message": "The phone connector is installed, but outbound calling is locked."
                    }
                    """.utf8
                ),
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 403,
                    httpVersion: nil,
                    headerFields: nil
                )!
            )
        }

        do {
            let _: PhonePilotStartResponse = try await client.start(
                baseURL: baseURL,
                credentials: credentials,
                dialRequest: PhoneDialRequest(
                    destinationNumber: "480-555-0102",
                    callObjective: "Run a brief, disclosed AI telephone test."
                )
            )
            XCTFail("A disabled pilot must reject the call.")
        } catch {
            XCTAssertEqual(
                error.localizedDescription,
                "The phone connector is installed, but outbound calling is locked."
            )
        }
    }

    func testCallRecordAppliesStatusAndStopUpdates() {
        var call = PhonePilotCall(
            start: PhonePilotStartResponse(
                leaseId: "test-lease",
                expiresAt: 123456789,
                status: "queued",
                maxCallSeconds: 300
            )
        )

        call.apply(
            PhonePilotStatusResponse(
                status: "in-progress",
                durationSeconds: 12,
                priceUsd: nil,
                priceUnit: nil,
                terminal: false
            )
        )
        XCTAssertTrue(call.isActive)
        XCTAssertEqual(call.durationSeconds, 12)

        call.apply(
            PhonePilotStopResponse(
                stopped: true,
                status: "completed"
            )
        )
        XCTAssertFalse(call.isActive)
        XCTAssertEqual(call.status, "completed")
    }

    func testCallRecordCanBeRecoveredAfterAppRelaunch() {
        let call = PhonePilotCall(
            recovered: PhonePilotRecoveredCall(
                leaseId: "recovered-lease",
                expiresAt: 123456789,
                status: "provider-unknown",
                maxCallSeconds: 300
            )
        )

        XCTAssertTrue(call.isActive)
        XCTAssertEqual(call.leaseId, "recovered-lease")
        XCTAssertEqual(call.status, "provider-unknown")
    }
}

private actor PhonePilotRequestRecorder {
    private(set) var request: URLRequest?

    func capture(_ request: URLRequest) {
        self.request = request
    }
}
