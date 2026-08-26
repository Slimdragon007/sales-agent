import Foundation

enum AppConfiguration {
    static let workerBaseURL: URL = {
        guard
            let rawValue = Bundle.main.object(forInfoDictionaryKey: "WorkerBaseURL") as? String,
            let url = URL(string: rawValue),
            url.scheme == "https",
            url.host != nil
        else {
            preconditionFailure("WorkerBaseURL must be a valid HTTPS URL.")
        }

        return url
    }()
}
