import Foundation

struct PhonePilotClient: Sendable {
    typealias DataLoader =
        @Sendable (URLRequest) async throws -> (Data, URLResponse)

    private let dataLoader: DataLoader

    init(
        dataLoader: @escaping DataLoader = { request in
            try await URLSession.shared.data(for: request)
        }
    ) {
        self.dataLoader = dataLoader
    }

    func listContacts(
        baseURL: URL,
        credentials: PreviewCredentials
    ) async throws -> [PhoneContact] {
        let response: PhonePilotContactsResponse = try await send(
            request(
                baseURL: baseURL,
                path: "api/phone-pilot/contacts",
                credentials: credentials,
                method: "GET"
            )
        )
        return response.contacts
    }

    func listRecents(
        baseURL: URL,
        credentials: PreviewCredentials
    ) async throws -> [PhoneRecent] {
        let response: PhonePilotRecentsResponse = try await send(
            request(
                baseURL: baseURL,
                path: "api/phone-pilot/recents",
                credentials: credentials,
                method: "GET"
            )
        )
        return response.recents
    }

    func start(
        baseURL: URL,
        credentials: PreviewCredentials,
        dialRequest: PhoneDialRequest
    ) async throws -> PhonePilotStartResponse {
        var startRequest = try request(
            baseURL: baseURL,
            path: "api/phone-pilot/start",
            credentials: credentials
        )
        startRequest.setValue(
            "application/json",
            forHTTPHeaderField: "Content-Type"
        )
        startRequest.httpBody = try JSONEncoder().encode(dialRequest)

        return try await send(startRequest)
    }

    func startContact(
        baseURL: URL,
        credentials: PreviewCredentials,
        contactId: String,
        callObjective: String
    ) async throws -> PhonePilotStartResponse {
        try await start(
            baseURL: baseURL,
            credentials: credentials,
            dialRequest: .contact(id: contactId, objective: callObjective)
        )
    }

    func startNewNumber(
        baseURL: URL,
        credentials: PreviewCredentials,
        destinationNumber: String,
        displayName: String?,
        callObjective: String,
        saveContact: Bool
    ) async throws -> PhonePilotStartResponse {
        try await start(
            baseURL: baseURL,
            credentials: credentials,
            dialRequest: .newNumber(
                destinationNumber: destinationNumber,
                displayName: displayName,
                objective: callObjective,
                attestation: true,
                saveContact: saveContact
            )
        )
    }

    func startSelfTest(
        baseURL: URL,
        credentials: PreviewCredentials
    ) async throws -> PhonePilotStartResponse {
        var startRequest = try request(
            baseURL: baseURL,
            path: "api/phone-pilot/start",
            credentials: credentials
        )
        startRequest.httpBody = Data()

        return try await send(startRequest)
    }

    /// Dials the verified recipient with a custom objective and no destination body field.
    func startVerified(
        baseURL: URL,
        credentials: PreviewCredentials,
        callObjective: String
    ) async throws -> PhonePilotStartResponse {
        var startRequest = try request(
            baseURL: baseURL,
            path: "api/phone-pilot/start",
            credentials: credentials
        )
        startRequest.setValue(
            "application/json",
            forHTTPHeaderField: "Content-Type"
        )
        startRequest.httpBody = try JSONEncoder().encode(
            PhoneDialRequest(verifiedRecipientObjective: callObjective)
        )

        return try await send(startRequest)
    }

    func current(
        baseURL: URL,
        credentials: PreviewCredentials
    ) async throws -> PhonePilotCurrentResponse {
        try await send(
            request(
                baseURL: baseURL,
                path: "api/phone-pilot/current",
                credentials: credentials,
                method: "GET"
            )
        )
    }

    func status(
        baseURL: URL,
        credentials: PreviewCredentials,
        leaseId: String
    ) async throws -> PhonePilotStatusResponse {
        try await send(
            request(
                baseURL: baseURL,
                path: "api/phone-pilot/status",
                credentials: credentials,
                leaseId: leaseId
            )
        )
    }

    func stop(
        baseURL: URL,
        credentials: PreviewCredentials,
        leaseId: String
    ) async throws -> PhonePilotStopResponse {
        try await send(
            request(
                baseURL: baseURL,
                path: "api/phone-pilot/stop",
                credentials: credentials,
                leaseId: leaseId
            )
        )
    }

    private func request(
        baseURL: URL,
        path: String,
        credentials: PreviewCredentials,
        method: String = "POST",
        leaseId: String? = nil
    ) throws -> URLRequest {
        let endpoint = baseURL.appending(path: path)
        var request = URLRequest(url: endpoint)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(
            AuthorizationHeader.basic(for: credentials),
            forHTTPHeaderField: "Authorization"
        )
        request.setValue(
            "owner-ui-v1",
            forHTTPHeaderField: "X-Slim-Request-Intent"
        )
        request.timeoutInterval = 15

        if let leaseId {
            request.setValue(
                "application/json",
                forHTTPHeaderField: "Content-Type"
            )
            request.httpBody = try JSONEncoder().encode(
                PhonePilotLeaseRequest(leaseId: leaseId)
            )
        }

        return request
    }

    private func send<Response: Decodable>(
        _ request: URLRequest
    ) async throws -> Response {
        let (data, response) = try await dataLoader(request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PhonePilotClientError.invalidResponse
        }

        guard (200 ..< 300).contains(httpResponse.statusCode) else {
            if httpResponse.statusCode == 401 {
                throw PhonePilotClientError.unauthorized
            }

            if
                let payload = try? JSONDecoder().decode(
                    PhonePilotErrorResponse.self,
                    from: data
                ),
                let message = payload.message
            {
                throw PhonePilotClientError.rejected(message)
            }

            throw PhonePilotClientError.server(httpResponse.statusCode)
        }

        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw PhonePilotClientError.invalidPayload
        }
    }
}

private struct PhonePilotContactsResponse: Decodable {
    let contacts: [PhoneContact]
}

private struct PhonePilotRecentsResponse: Decodable {
    let recents: [PhoneRecent]
}

private struct PhonePilotLeaseRequest: Encodable {
    let leaseId: String
}

private struct PhonePilotErrorResponse: Decodable {
    let message: String?
}

enum PhonePilotClientError: LocalizedError {
    case invalidPayload
    case invalidResponse
    case rejected(String)
    case server(Int)
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .invalidPayload:
            "The Worker returned an unexpected phone response."
        case .invalidResponse:
            "The Worker did not return a valid response."
        case let .rejected(message):
            message
        case let .server(statusCode):
            "The phone Worker returned status \(statusCode)."
        case .unauthorized:
            "The preview username or password was not accepted."
        }
    }
}
