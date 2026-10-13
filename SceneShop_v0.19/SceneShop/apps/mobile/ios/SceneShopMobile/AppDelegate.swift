import UIKit
import UserNotifications

@main
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var window: UIWindow?
    private var root: SceneShopWebViewController? { window?.rootViewController as? SceneShopWebViewController }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        let controller = SceneShopWebViewController()
        window.rootViewController = controller
        window.makeKeyAndVisible()
        self.window = window
        UNUserNotificationCenter.current().delegate = self
        if let url = launchOptions?[.url] as? URL { controller.open(deepLink: url) }
        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey : Any] = [:]) -> Bool {
        root?.open(deepLink: url)
        return true
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        guard userActivity.activityType == NSUserActivityTypeBrowsingWeb, let url = userActivity.webpageURL else { return false }
        root?.open(deepLink: url)
        return true
    }

    func applicationWillEnterForeground(_ application: UIApplication) { root?.emitLifecycle("FOREGROUND") }
    func applicationDidEnterBackground(_ application: UIApplication) { root?.emitLifecycle("BACKGROUND") }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        root?.emitNativeEvent(type: "NOTIFICATION_REGISTRATION", payload: ["registration":"TOKEN_AVAILABLE", "token":token, "tokenProvider":"APNS"])
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        root?.emitNativeEvent(type: "NOTIFICATION_REGISTRATION", payload: ["registration":"TOKEN_UNAVAILABLE", "error":error.localizedDescription, "tokenProvider":"APNS"])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        root?.emitNativeEvent(type: "NOTIFICATION_RECEIVED", payload: ["foreground":true, "userInfo":notification.request.content.userInfo])
        completionHandler([.banner, .sound])
    }
}
