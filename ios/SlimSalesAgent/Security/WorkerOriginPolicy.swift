import Foundation

struct WorkerOriginPolicy: Equatable {
    let baseURL: URL

    init?(baseURL: URL) {
        guard baseURL.scheme == "https", baseURL.host != nil else {
            return nil
        }
        self.baseURL = baseURL
    }

    func allows(_ candidate: URL) -> Bool {
        guard
            candidate.scheme?.lowercased() == "https",
            let candidateHost = candidate.host?.lowercased(),
            let allowedHost = baseURL.host?.lowercased()
        else {
            return false
        }

        return candidateHost == allowedHost
            && candidate.port == baseURL.port
    }

    func allowsHTTPSOrigin(host: String, scheme: String, port: Int) -> Bool {
        let allowedPort = baseURL.port ?? 443
        let normalizedPort = port == 0 ? 443 : port

        return scheme.lowercased() == "https"
            && host.lowercased() == baseURL.host?.lowercased()
            && normalizedPort == allowedPort
    }
}
