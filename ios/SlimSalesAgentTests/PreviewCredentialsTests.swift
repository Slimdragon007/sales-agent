import XCTest
@testable import SlimSalesAgent

final class PreviewCredentialsTests: XCTestCase {
    func testBasicAuthorizationHeader() throws {
        let credentials = try PreviewCredentials(
            username: "owner",
            password: "private password"
        )

        XCTAssertEqual(
            AuthorizationHeader.basic(for: credentials),
            "Basic b3duZXI6cHJpdmF0ZSBwYXNzd29yZA=="
        )
    }

    func testUsernameCannotContainBasicAuthenticationSeparator() {
        XCTAssertThrowsError(
            try PreviewCredentials(username: "owner:other", password: "password")
        )
    }
}
