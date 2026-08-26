import XCTest
@testable import SlimSalesAgent

final class WorkerOriginPolicyTests: XCTestCase {
    func testAllowsOnlyExactHTTPSWorkerOrigin() throws {
        let baseURL = try XCTUnwrap(
            URL(string: "https://agent.example.com")
        )
        let policy = try XCTUnwrap(WorkerOriginPolicy(baseURL: baseURL))

        XCTAssertTrue(policy.allows(try XCTUnwrap(URL(string: "https://agent.example.com/settings"))))
        XCTAssertFalse(policy.allows(try XCTUnwrap(URL(string: "http://agent.example.com"))))
        XCTAssertFalse(policy.allows(try XCTUnwrap(URL(string: "https://evil.example.com"))))
        XCTAssertFalse(policy.allows(try XCTUnwrap(URL(string: "https://agent.example.com.evil.test"))))
        XCTAssertFalse(policy.allows(try XCTUnwrap(URL(string: "https://agent.example.com:444"))))

        XCTAssertTrue(
            policy.allowsHTTPSOrigin(
                host: "agent.example.com",
                scheme: "https",
                port: 443
            )
        )
        XCTAssertTrue(
            policy.allowsHTTPSOrigin(
                host: "agent.example.com",
                scheme: "https",
                port: 0
            )
        )
        XCTAssertFalse(
            policy.allowsHTTPSOrigin(
                host: "agent.example.com",
                scheme: "https",
                port: 444
            )
        )
    }
}
