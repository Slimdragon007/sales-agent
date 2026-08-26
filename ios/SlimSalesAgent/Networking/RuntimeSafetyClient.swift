import Foundation

struct RuntimeSafetyClient {
    func fetch(
        baseURL: URL,
        credentials: PreviewCredentials
    ) async throws -> RuntimeSafety {
        let endpoint = baseURL.appending(path: "api/runtime-safety")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(
            AuthorizationHeader.basic(for: credentials),
            forHTTPHeaderField: "Authorization"
        )
        request.timeoutInterval = 15

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw RuntimeSafetyClientError.invalidResponse
        }

        switch httpResponse.statusCode {
        case 200:
            do {
                return try JSONDecoder().decode(RuntimeSafety.self, from: data)
            } catch {
                throw RuntimeSafetyClientError.invalidPayload
            }
        case 401:
            throw RuntimeSafetyClientError.unauthorized
        default:
            throw RuntimeSafetyClientError.server(httpResponse.statusCode)
        }
    }
}

enum RuntimeSafetyClientError: LocalizedError {
    case invalidPayload
    case invalidResponse
    case server(Int)
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .invalidPayload:
            "The Worker returned an unexpected safety response."
        case .invalidResponse:
            "The Worker did not return a valid response."
        case let .server(statusCode):
            "The Worker returned status \(statusCode). Try again."
        case .unauthorized:
            "The preview username or password was not accepted."
        }
    }
}
