import UIKit
import Messages
import WebKit
import Security

/// DormCheck iMessage app extension.
/// Hosts the lightweight web UI at /imessage in a WKWebView; the page requests
/// message composition via window.webkit.messageHandlers.dormcheck.postMessage.
/// The sent bubble is rendered natively with MSMessageTemplateLayout, so it has
/// no dependency on Open Graph endpoints.
///
/// Session sharing: the host app persists the Supabase session in the Keychain
/// (via @aparajita/capacitor-secure-storage / KeychainSwift, account
/// "capacitor-storage_sb-<ref>-auth-token", no explicit access group -> the
/// app's default group). Because App/AppRelease/MessagesExtension entitlements
/// all list the same keychain-access-group ($(AppIdentifierPrefix)com.dormcheck.ios),
/// this extension can read that same item and hand the tokens to the web page
/// (window.__dcSetSession). The page then shows the signed-in user's own data
/// (roommate invites, saved dorms). If there is no session (signed out), nothing
/// is injected and the page falls back to its paste-only UI.
class MessagesViewController: MSMessagesAppViewController, WKScriptMessageHandler, WKNavigationDelegate {

    private static let shareURL = URL(string: "https://dormcheck.com/imessage?imessage=1")!
    // Only URLs on these hosts may be embedded in an outgoing message.
    private static let allowedMessageHosts: Set<String> = ["dormcheck.com", "www.dormcheck.com"]

    private var webView: WKWebView!
    private let errorLabel = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "dormcheck")

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        view.addSubview(webView)

        errorLabel.text = "Couldn't load DormCheck. Check your connection and try again."
        errorLabel.textAlignment = .center
        errorLabel.numberOfLines = 0
        errorLabel.textColor = .secondaryLabel
        errorLabel.frame = view.bounds.insetBy(dx: 24, dy: 0)
        errorLabel.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        errorLabel.isHidden = true
        view.addSubview(errorLabel)

        loadSharePage()
    }

    private func loadSharePage() {
        errorLabel.isHidden = true
        webView.isHidden = false
        let request = URLRequest(url: Self.shareURL,
                                 cachePolicy: .useProtocolCachePolicy,
                                 timeoutInterval: 10)
        webView.load(request)
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        injectSharedSessionIfAvailable()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showLoadError()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showLoadError()
    }

    private func showLoadError() {
        webView.isHidden = true
        errorLabel.isHidden = false
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "dormcheck",
              let body = message.body as? [String: Any],
              let action = body["action"] as? String, action == "sendMessage",
              let urlString = body["url"] as? String,
              let messageURL = URL(string: urlString),
              let host = messageURL.host?.lowercased(),
              messageURL.scheme == "https",
              Self.allowedMessageHosts.contains(host) else { return }

        let title = (body["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Check this out on DormCheck"
        let imageURLString = body["imageURL"] as? String

        if let imageURLString = imageURLString,
           let imageURL = URL(string: imageURLString),
           imageURL.scheme == "https",
           let imageHost = imageURL.host?.lowercased(),
           Self.allowedMessageHosts.contains(imageHost) {
            downloadImage(from: imageURL) { [weak self] image in
                self?.insertMessage(url: messageURL, caption: title, image: image)
            }
        } else {
            insertMessage(url: messageURL, caption: title, image: nil)
        }
    }

    private func insertMessage(url: URL, caption: String, image: UIImage?) {
        let layout = MSMessageTemplateLayout()
        layout.caption = caption
        layout.image = image

        let message = MSMessage(session: MSSession())
        message.url = url
        message.layout = layout
        message.summaryText = caption

        activeConversation?.insert(message) { [weak self] _ in
            DispatchQueue.main.async {
                self?.requestPresentationStyle(.compact)
            }
        }
    }

    private func downloadImage(from url: URL, completion: @escaping (UIImage?) -> Void) {
        var request = URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 5)
        request.setValue("DormCheckMessages/1.0", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: request) { data, _, _ in
            let image = data.flatMap { UIImage(data: $0) }
            DispatchQueue.main.async { completion(image) }
        }.resume()
    }

    // MARK: - Shared session (read host Keychain -> inject into the web page)

    /// Reads the host app's Supabase session from the shared Keychain group and,
    /// if present, hands the tokens to the web page. No-op when signed out.
    private func injectSharedSessionIfAvailable() {
        guard let tokens = readSharedSupabaseSession(),
              let accessJSON = jsonString(tokens.access),
              let refreshJSON = jsonString(tokens.refresh) else { return }

        // The page defines window.__dcSetSession on mount; if native runs first,
        // stash the tokens on window.__dcPendingSession for the page to drain.
        let js = """
        (function(a, r) {
          if (typeof window.__dcSetSession === 'function') { window.__dcSetSession(a, r); }
          else { window.__dcPendingSession = { access: a, refresh: r }; }
        })(\(accessJSON), \(refreshJSON));
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    /// Enumerates generic-password Keychain items visible to this extension
    /// (spanning all of its access groups, including the shared host group) and
    /// returns the access/refresh tokens from the Supabase auth-token item.
    private func readSharedSupabaseSession() -> (access: String, refresh: String)? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecReturnAttributes as String: true,
            kSecReturnData as String: true
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let items = result as? [[String: Any]] else { return nil }

        for item in items {
            // Account is "capacitor-storage_" + supabase storageKey ("sb-<ref>-auth-token").
            // The transient "-code-verifier" item ends differently and is skipped.
            guard let account = item[kSecAttrAccount as String] as? String,
                  account.hasPrefix("capacitor-storage_sb-"),
                  account.hasSuffix("-auth-token"),
                  let data = item[kSecValueData as String] as? Data else { continue }
            if let tokens = parseSession(data) { return tokens }
        }
        return nil
    }

    /// Parses the stored supabase-js session (plain JSON, or a "base64-" prefixed
    /// base64url-encoded JSON) into access + refresh tokens.
    private func parseSession(_ data: Data) -> (access: String, refresh: String)? {
        var jsonData = data
        if let raw = String(data: data, encoding: .utf8), raw.hasPrefix("base64-") {
            let encoded = String(raw.dropFirst("base64-".count))
            if let decoded = decodeBase64URL(encoded) { jsonData = decoded }
        }
        guard let obj = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else { return nil }
        // supabase-js stores the session object directly; older shapes nested it.
        let session = (obj["currentSession"] as? [String: Any]) ?? obj
        guard let access = session["access_token"] as? String, !access.isEmpty,
              let refresh = session["refresh_token"] as? String, !refresh.isEmpty else { return nil }
        return (access, refresh)
    }

    private func decodeBase64URL(_ input: String) -> Data? {
        var s = input.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while s.count % 4 != 0 { s.append("=") }
        return Data(base64Encoded: s)
    }

    /// JSON-encodes a string (with surrounding quotes) so it is safe to embed as a
    /// JS literal in evaluateJavaScript.
    private func jsonString(_ value: String) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: [value], options: []),
              let arr = String(data: data, encoding: .utf8) else { return nil }
        // arr == "[\"...\"]"; strip the array brackets to get the quoted string.
        return String(arr.dropFirst().dropLast())
    }

    // MARK: - Presentation style

    override func didTransition(to presentationStyle: MSMessagesAppPresentationStyle) {
        super.didTransition(to: presentationStyle)
        let style = presentationStyle == .expanded ? "expanded" : "compact"
        webView?.evaluateJavaScript(
            "window.__imessagePresentation = '\(style)'; window.dispatchEvent(new CustomEvent('imessage-presentation', { detail: '\(style)' }));",
            completionHandler: nil
        )
    }
}
