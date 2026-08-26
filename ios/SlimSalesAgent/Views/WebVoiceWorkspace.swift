import SwiftUI
import WebKit

struct WebVoiceWorkspace: View {
    @Environment(\.dismiss) private var dismiss

    let baseURL: URL
    let credentials: PreviewCredentials

    var body: some View {
        NavigationStack {
            WebVoiceView(baseURL: baseURL, credentials: credentials)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle("Voice workspace")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Done") {
                            dismiss()
                        }
                    }
                }
        }
        .preferredColorScheme(.light)
    }
}

private struct WebVoiceView: UIViewRepresentable {
    let baseURL: URL
    let credentials: PreviewCredentials

    func makeCoordinator() -> Coordinator {
        Coordinator(baseURL: baseURL, credentials: credentials)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isInspectable = false
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
        webView.load(URLRequest(url: baseURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.loadHTMLString("", baseURL: nil)
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        private let credentials: PreviewCredentials
        private let originPolicy: WorkerOriginPolicy

        init(baseURL: URL, credentials: PreviewCredentials) {
            guard let originPolicy = WorkerOriginPolicy(baseURL: baseURL) else {
                preconditionFailure("The voice workspace requires an HTTPS Worker URL.")
            }
            self.originPolicy = originPolicy
            self.credentials = credentials
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
        ) {
            guard
                let candidate = navigationAction.request.url,
                originPolicy.allows(candidate)
            else {
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        func webView(
            _ webView: WKWebView,
            didReceive challenge: URLAuthenticationChallenge,
            completionHandler: @escaping @MainActor @Sendable (
                URLSession.AuthChallengeDisposition,
                URLCredential?
            ) -> Void
        ) {
            let protectionSpace = challenge.protectionSpace
            guard protectionSpace.authenticationMethod == NSURLAuthenticationMethodHTTPBasic else {
                completionHandler(.performDefaultHandling, nil)
                return
            }
            guard
                originPolicy.allowsHTTPSOrigin(
                    host: protectionSpace.host,
                    scheme: protectionSpace.protocol ?? "",
                    port: protectionSpace.port
                ),
                challenge.previousFailureCount == 0
            else {
                completionHandler(.cancelAuthenticationChallenge, nil)
                return
            }

            completionHandler(
                .useCredential,
                URLCredential(
                    user: credentials.username,
                    password: credentials.password,
                    persistence: .forSession
                )
            )
        }

        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void
        ) {
            let isAllowedOrigin = originPolicy.allowsHTTPSOrigin(
                host: origin.host,
                scheme: origin.protocol,
                port: origin.port
            )
            let requestsAudioOnly = type == .microphone
            decisionHandler(isAllowedOrigin && requestsAudioOnly ? .grant : .deny)
        }
    }
}
