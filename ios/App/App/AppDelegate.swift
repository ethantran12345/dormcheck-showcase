import UIKit
import Capacitor
import WebKit

/// UIKit-owned, iOS-only tab chrome for the Capacitor shell.
///
/// This is deliberately a visual/input layer, not a second router. React posts
/// `{ visible, route }` through `dormcheckNativeGlassTabBar`; tab taps are sent
/// back as a DOM event for React Router to resolve. That keeps deep links,
/// notification routing, and the Android/web navigation model authoritative in
/// one place.
@objc(NativeGlassBridgeViewController)
final class NativeGlassBridgeViewController: CAPBridgeViewController, WKScriptMessageHandler, UITabBarDelegate {
    private static let bridgeName = "dormcheckNativeGlassTabBar"
    private static let shareBridgeName = "dormcheckNativeShare"
    private let tabIDs = ["home", "housing", "checklist", "marketplace"]
    // Exact Lucide vectors used by the desktop AppSidebar, packaged as native
    // template assets so iOS and web share one icon language.
    private let tabAssetNames = ["NavHome", "NavHousing", "NavChecklist", "NavMarket"]
    private let tabLabels = ["Home", "Housing", "Checklist", "Market"]

    private var chromeContainer: UIView?
    private var tabBar: UITabBar?
    private var moreButton: UIButton?
    // All four are retuned every layout pass from the measured platter.
    private var moreCenterY: NSLayoutConstraint?
    private var barLeading: NSLayoutConstraint?
    private var barTrailing: NSLayoutConstraint?
    private var containerBottom: NSLayoutConstraint?
    /// Magnification the current tab artwork was drawn for.
    private var artworkScale: CGFloat = 1
    private var selectedTab: String = "home"
    private var isBarVisible = false

    private let activeColor = UIColor(red: 0.012, green: 0.753, blue: 0.235, alpha: 1)
    /// Inactive destinations read at the same weight as the ⊞ launcher's glyph
    /// (UIKit renders a `.glass()` button's symbol at near-label black), so the
    /// bar's two halves match instead of the tabs sitting a shade back in gray.
    ///
    /// Deliberately a fixed value, not `UIColor.label`: the glass platter and the
    /// launcher's symbol both follow the material - which is lit by the webview
    /// behind it - and the web app renders light in either system appearance. A
    /// dynamic color flipped these glyphs to white in dark mode and left them
    /// invisible on a bar that had stayed light.
    private let inactiveColor = UIColor(white: 0.098, alpha: 1)
    // Bottom-chrome metrics, measured off a Bevel screenshot (1170×2532, so a
    // 390×844pt device) and expressed in the same on-screen points here: capsule
    // and launcher 61pt tall, 21pt from each screen edge, 9pt between them, and
    // the whole thing sitting 24pt off the bottom - noticeably lower and wider
    // than UIKit's own floating-bar defaults.
    //
    // Everything below is a FINAL, on-screen size. The tab artwork is drawn at
    // these numbers and then handed to UIKit pre-divided by the bar's
    // magnification (see `navItemImage`), so what lands on glass measures what
    // is written here.

    /// Lucide glyphs share a 24pt canvas but not the same visible bounds.
    /// These small optical corrections equalize their perceived footprint.
    /// Bevel's glyphs measure ~19.5pt tall; a Lucide vector inks about 83% of its
    /// box, so these are sized so the drawn mark - not the box - matches theirs.
    private let tabIconSizes: [CGFloat] = [23.5, 22.5, 24.5, 23.5]
    /// Height of both halves of the bottom chrome: the ⊞ launcher's diameter, and
    /// the target the tab capsule is magnified to in `viewDidLayoutSubviews`, so
    /// the capsule and the circle read as one control rather than two sizes.
    private let chromeControlHeight: CGFloat = 61
    /// Gap between the tab capsule and the ⊞ launcher.
    private let chromeGap: CGFloat = 9
    /// Inset from each screen edge.
    private let chromeSideMargin: CGFloat = 21
    /// Gap under the visible capsule. Bevel clears the screen bottom by this much
    /// rather than the safe area, so the bar deliberately overlaps the
    /// home-indicator strip the way theirs does.
    private let chromeBottomMargin: CGFloat = 24

    override func viewDidLoad() {
        super.viewDidLoad()
        // React Router writes browser history into this WKWebView, so the
        // platform's left-edge back swipe can remain a native muscle-memory
        // gesture on pushed/detail routes without a custom recognizer.
        webView?.allowsBackForwardNavigationGestures = true
        webView?.configuration.userContentController.add(self, name: Self.bridgeName)
        webView?.configuration.userContentController.add(self, name: Self.shareBridgeName)
        installGlassBar()
        observeKeyboard()
    }

    /// UIKit's floating glass platter has a fixed intrinsic height (51pt on iOS
    /// 26.5) that no public API resizes - taller item artwork does not grow it,
    /// and the 72pt layout box just leaves transparent slack below it. To match
    /// the ⊞ launcher's diameter the bar is magnified by a UNIFORM scale, so the
    /// capsule, its selection lens, the glyphs and the labels all grow together.
    ///
    /// This is deliberately not the earlier y-only scale: the selection lens is a
    /// plain background subview, so an anisotropic scale stretched it into a tall
    /// oval that no inverse-transform pass could reach. The bar's untransformed
    /// frame is wider than the visible capsule (21pt of transparent gutter each
    /// side), which is why magnifying it cannot collide with the launcher.
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard let bar = tabBar, let container = chromeContainer,
              let platter = bar.subviews.first else { return }
        // The platter is the bar's own first subview. Its bounds are unaffected
        // by the transform, so these stay stable measurements across passes:
        // 51pt tall on iOS 26.5, and inset a constant 21pt inside the bar frame.
        let platterHeight = platter.bounds.height
        let gutter = max(0, (bar.bounds.width - platter.bounds.width) / 2)
        guard platterHeight > 1 else { return }
        // Pre-iOS-26 the fallback capsule already fills the whole layout box, so
        // the ratio lands below 1 and the clamp leaves that path untouched.
        let scale = min(1.4, max(1, chromeControlHeight / platterHeight))
        bar.transform = CGAffineTransform(scaleX: scale, y: scale)

        // The artwork is drawn for one magnification; redraw if that changed.
        if abs(artworkScale - scale) > 0.01 {
            artworkScale = scale
            applyTabArtwork(to: bar)
        }

        // Horizontal: magnifying about the frame's center also widens the visible
        // capsule, so the frame is inset by the overhang to land the capsule
        // exactly in the space left of the launcher.
        let available = container.bounds.width - chromeControlHeight - chromeGap
        let inset = max(0, (available - (available / scale + gutter * 2)) / 2)
        setConstant(barLeading, to: inset)
        setConstant(barTrailing, to: -(chromeGap + inset))

        // Vertical: the platter is top-aligned in the layout box and the scale is
        // centered, so the visible capsule lifts off the box's bottom edge by a
        // slack the bottom margin has to give back.
        let capsuleBottom = container.bounds.height / 2 * (1 - scale) + platterHeight * scale
        let slack = container.bounds.height - capsuleBottom
        setConstant(containerBottom, to: slack - chromeBottomMargin)
        setConstant(moreCenterY, to: -(container.bounds.height / 2 - platterHeight / 2) * scale)
    }

    /// Constraint constants are retuned from measurements taken during layout, so
    /// they are only written when they actually move - otherwise every pass would
    /// dirty the layout and schedule another one.
    private func setConstant(_ constraint: NSLayoutConstraint?, to value: CGFloat) {
        guard let constraint, abs(constraint.constant - value) > 0.5 else { return }
        constraint.constant = value
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: Self.bridgeName)
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: Self.shareBridgeName)
        NotificationCenter.default.removeObserver(self)
    }

    private func installGlassBar() {
        guard chromeContainer == nil else { return }

        let container = UIView()
        container.translatesAutoresizingMaskIntoConstraints = false
        container.isHidden = true
        container.accessibilityIdentifier = "native-glass-tab-bar"
        view.addSubview(container)

        let bar = UITabBar()
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.delegate = self
        bar.tintColor = activeColor
        bar.unselectedItemTintColor = inactiveColor
        bar.itemPositioning = .fill
        bar.items = tabLabels.enumerated().map { index, label in
            let item = UITabBarItem(title: nil, image: nil, selectedImage: nil)
            item.tag = index
            item.accessibilityLabel = label
            item.accessibilityIdentifier = "native-glass-tab-\(tabIDs[index])"
            return item
        }
        applyTabArtwork(to: bar)
        // iOS 26's glass tab bar can override item-level normal colors. Apply
        // the same hierarchy through each layout appearance without replacing
        // the system material or its animated selection lens.
        let appearance = bar.standardAppearance
        for itemAppearance in [
            appearance.stackedLayoutAppearance,
            appearance.inlineLayoutAppearance,
            appearance.compactInlineLayoutAppearance,
        ] {
            itemAppearance.normal.iconColor = inactiveColor
            itemAppearance.normal.titleTextAttributes = [
                .font: Self.tabLabelFont,
                .foregroundColor: inactiveColor,
            ]
            itemAppearance.selected.iconColor = activeColor
            itemAppearance.selected.titleTextAttributes = [
                .font: Self.tabLabelFont,
                .foregroundColor: activeColor,
            ]
        }
        bar.standardAppearance = appearance
        bar.scrollEdgeAppearance = appearance
        if #unavailable(iOS 26.0) {
            let appearance = UITabBarAppearance()
            appearance.configureWithTransparentBackground()
            appearance.backgroundEffect = UIBlurEffect(style: .systemUltraThinMaterial)
            appearance.shadowColor = .clear
            bar.standardAppearance = appearance
            bar.scrollEdgeAppearance = appearance
            bar.layer.cornerRadius = 31
            bar.clipsToBounds = true
            bar.layer.borderWidth = 0.5
            bar.layer.borderColor = UIColor.white.withAlphaComponent(0.5).cgColor
        }
        container.addSubview(bar)

        let more = UIButton(type: .system)
        more.translatesAutoresizingMaskIntoConstraints = false
        more.accessibilityIdentifier = "native-glass-tab-more"
        more.accessibilityLabel = "More"
        more.addTarget(self, action: #selector(didTapMore), for: .touchUpInside)
        configureMoreButton(more, menuOpen: false)
        container.addSubview(more)

        // The launcher is anchored to the container alone and the bar is fitted
        // into what is left, so the magnified capsule can be positioned without
        // dragging the circle around with it. Every constant marked here is
        // retuned in `viewDidLayoutSubviews` once the platter has been measured.
        let moreCenter = more.centerYAnchor.constraint(equalTo: container.centerYAnchor)
        let barLead = bar.leadingAnchor.constraint(equalTo: container.leadingAnchor)
        let barTrail = bar.trailingAnchor.constraint(equalTo: more.leadingAnchor)
        let bottom = container.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        NSLayoutConstraint.activate([
            container.leadingAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: chromeSideMargin),
            container.trailingAnchor.constraint(
                equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -chromeSideMargin),
            bottom,
            container.heightAnchor.constraint(equalToConstant: 72),
            barLead,
            barTrail,
            bar.topAnchor.constraint(equalTo: container.topAnchor),
            bar.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            more.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            moreCenter,
            more.heightAnchor.constraint(equalToConstant: chromeControlHeight),
            more.widthAnchor.constraint(equalToConstant: chromeControlHeight),
        ])

        chromeContainer = container
        tabBar = bar
        moreButton = more
        moreCenterY = moreCenter
        barLeading = barLead
        barTrailing = barTrail
        containerBottom = bottom
        updateSelection(animated: false)
    }

    /// Draws each tab's composed icon+label artwork. The colors are baked into
    /// the bitmap because UIKit's floating bar overrides item-level normal
    /// colors, which is why these are `.alwaysOriginal` rather than templates
    /// tinted from the appearance proxy.
    private func applyTabArtwork(to bar: UITabBar) {
        for (index, item) in (bar.items ?? []).enumerated() {
            guard tabLabels.indices.contains(index) else { continue }
            // Keep the desktop Lucide family, but give it enough optical size
            // to remain legible inside the native glass platter. The glass
            // selection lens and malachite tint carry active state; changing
            // families or filling the glyph would break desktop parity.
            item.image = navItemImage(
                named: tabAssetNames[index],
                iconSize: tabIconSizes[index],
                label: tabLabels[index],
                color: inactiveColor
            )
            item.selectedImage = navItemImage(
                named: tabAssetNames[index],
                iconSize: tabIconSizes[index],
                label: tabLabels[index],
                color: activeColor
            )
        }
    }

    private static let tabLabelFont = UIFont.systemFont(ofSize: 9.5, weight: .medium)

    private func navItemImage(
        named name: String,
        iconSize: CGFloat,
        label: String,
        color: UIColor
    ) -> UIImage? {
        guard let source = UIImage(named: name) else { return nil }
        // Bevel's stack, in final on-screen points: a ~19.5pt glyph, a ~8pt gap,
        // then the label - ~35pt of inked content centered in the 61pt capsule.
        // The slot is the icon BOX (a little taller than the mark inside it).
        let canvasSize = CGSize(width: 64, height: 39)
        let iconSlotHeight: CGFloat = 23.5
        let labelTop: CGFloat = 26.5
        let font = Self.tabLabelFont
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: color,
        ]
        let labelSize = (label as NSString).size(withAttributes: attributes)
        let format = UIGraphicsImageRendererFormat()
        format.scale = UIScreen.main.scale
        let renderer = UIGraphicsImageRenderer(size: canvasSize, format: format)
        let drawn = renderer.image { _ in
            source.withTintColor(color, renderingMode: .alwaysOriginal).draw(in: CGRect(
                x: (canvasSize.width - iconSize) / 2,
                y: (iconSlotHeight - iconSize) / 2,
                width: iconSize,
                height: iconSize
            ))
            (label as NSString).draw(at: CGPoint(
                x: (canvasSize.width - labelSize.width) / 2,
                y: labelTop
            ), withAttributes: attributes)
        }
        guard let bitmap = drawn.cgImage else { return drawn.withRenderingMode(.alwaysOriginal) }
        // UIKit lays the item out in the bar's UNMAGNIFIED space, so hand it the
        // same pixels at 1/scale of the drawn point size: the bar's transform then
        // restores the artwork to exactly the metrics above. Raising the image's
        // scale factor rather than shrinking the canvas keeps the extra pixels the
        // magnification needs, so the glyphs stay sharp at any bar size.
        return UIImage(cgImage: bitmap, scale: drawn.scale * artworkScale, orientation: .up)
            .withRenderingMode(.alwaysOriginal)
    }

    private func observeKeyboard() {
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillShow), name: UIResponder.keyboardWillShowNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillHide), name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    @objc private func keyboardWillShow() {
        chromeContainer?.isHidden = true
    }

    @objc private func keyboardWillHide() {
        chromeContainer?.isHidden = !isBarVisible
    }

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard tabIDs.indices.contains(item.tag) else { return }
        UISelectionFeedbackGenerator().selectionChanged()
        let tab = tabIDs[item.tag]
        guard let data = try? JSONSerialization.data(withJSONObject: ["tab": tab]),
              let payload = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript(
            "window.dispatchEvent(new CustomEvent('dormcheck-native-glass-tab-press', { detail: \(payload) }));",
            completionHandler: nil
        )
    }

    @objc private func didTapMore() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        webView?.evaluateJavaScript(
            "window.dispatchEvent(new CustomEvent('dormcheck-native-glass-more-press'));",
            completionHandler: nil
        )
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == Self.shareBridgeName {
            presentNativeShare(message.body)
            return
        }

        guard message.name == Self.bridgeName,
              let state = message.body as? [String: Any] else { return }

        DispatchQueue.main.async { [weak self] in
            if let visible = state["visible"] as? Bool {
                self?.setBarVisible(visible)
            }
            if let route = state["route"] as? String {
                self?.selectedTab = self?.tabForRoute(route) ?? "home"
                self?.updateSelection(animated: true)
            }
            if let menuOpen = state["menuOpen"] as? Bool, let moreButton = self?.moreButton {
                self?.configureMoreButton(moreButton, menuOpen: menuOpen)
            }
        }
    }

    private func presentNativeShare(_ body: Any) {
        guard let payload = body as? [String: Any] else { return }
        let text = payload["text"] as? String
        let title = payload["title"] as? String
        let urlString = payload["url"] as? String
        var items: [Any] = []
        if let text, !text.isEmpty { items.append(text) }
        if let urlString, let url = URL(string: urlString) { items.append(url) }
        guard !items.isEmpty else { return }

        DispatchQueue.main.async { [weak self] in
            guard let self, self.presentedViewController == nil else { return }
            let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
            sheet.setValue(title, forKey: "subject")
            if let popover = sheet.popoverPresentationController {
                popover.sourceView = self.view
                popover.sourceRect = CGRect(x: self.view.bounds.midX, y: self.view.bounds.maxY, width: 1, height: 1)
            }
            self.present(sheet, animated: true)
        }
    }

    private func setBarVisible(_ visible: Bool) {
        guard visible != isBarVisible else { return }
        isBarVisible = visible
        guard let container = chromeContainer else { return }
        if visible {
            container.isHidden = false
            container.transform = CGAffineTransform(translationX: 0, y: 84)
            UIView.animate(withDuration: 0.32, delay: 0, usingSpringWithDamping: 0.86, initialSpringVelocity: 0) {
                container.transform = .identity
            }
        } else {
            UIView.animate(withDuration: 0.2, animations: {
                container.transform = CGAffineTransform(translationX: 0, y: 84)
            }) { _ in
                container.isHidden = true
            }
        }
    }

    private func tabForRoute(_ route: String) -> String {
        if route == "/my-home" { return "home" }
        if route.hasPrefix("/housing") || route.hasPrefix("/campus") || route.hasPrefix("/gallery") || route == "/schedule" { return "housing" }
        if route == "/checklist" || route.hasPrefix("/logistics") { return "checklist" }
        if route.hasPrefix("/marketplace") { return "marketplace" }
        return selectedTab
    }

    private func updateSelection(animated: Bool) {
        guard let index = tabIDs.firstIndex(of: selectedTab),
              let item = tabBar?.items?[index] else { return }
        tabBar?.selectedItem = item
    }

    private func configureMoreButton(_ button: UIButton, menuOpen: Bool) {
        var configuration: UIButton.Configuration
        if #available(iOS 26.0, *) {
            configuration = .glass()
        } else {
            configuration = .gray()
        }
        // Bevel's + measures 18.4pt inside its 61pt circle; the ⊞ grid keeps that
        // ratio so our launcher differs from theirs only in the glyph itself.
        configuration.image = UIImage(
            systemName: menuOpen ? "xmark" : "square.grid.2x2",
            withConfiguration: UIImage.SymbolConfiguration(pointSize: 18.5, weight: .medium)
        )
        configuration.cornerStyle = .capsule
        // Restore the earlier small, quiet launcher while preserving the new
        // native glass configuration and its spring-driven state transition.
        configuration.baseForegroundColor = menuOpen
            ? UIColor(red: 0.012, green: 0.753, blue: 0.235, alpha: 1)
            : UIColor.secondaryLabel.withAlphaComponent(0.62)
        button.configuration = configuration
        button.accessibilityLabel = menuOpen ? "Close menu" : "More"
        button.accessibilityValue = menuOpen ? "Expanded" : "Collapsed"
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // Required by @capacitor/push-notifications: forward APNs registration
    // callbacks so the plugin can emit `registration` / `registrationError`.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

}
