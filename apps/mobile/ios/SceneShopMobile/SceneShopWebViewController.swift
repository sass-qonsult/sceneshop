import UIKit
import WebKit
import UserNotifications

final class SceneShopWebViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private var webView: WKWebView!
    private let baseURL = URL(string: "https://app.sceneshop.io/mobile")!
    private let allowed = Set(["NATIVE_READY","SHARE","OPEN_EXTERNAL","SECURE_GET","SECURE_SET","SECURE_DELETE","DEVICE_CONTEXT","NOTIFICATION_PERMISSION","NOTIFICATION_REGISTER"])
    private var allowedHost: String { baseURL.host ?? "app.sceneshop.io" }
    private var pendingEvents: [(String,[String:Any])] = []
    private var pageReady = false

    override func viewDidLoad() {
        super.viewDidLoad()
        let config = WKWebViewConfiguration(); config.websiteDataStore = .default(); config.userContentController.add(self, name: "sceneshop")
        webView = WKWebView(frame: .zero, configuration: config); webView.navigationDelegate = self; webView.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(webView)
        NSLayoutConstraint.activate([webView.leadingAnchor.constraint(equalTo:view.leadingAnchor),webView.trailingAnchor.constraint(equalTo:view.trailingAnchor),webView.topAnchor.constraint(equalTo:view.topAnchor),webView.bottomAnchor.constraint(equalTo:view.bottomAnchor)])
        webView.load(URLRequest(url: baseURL))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        let copy = pendingEvents; pendingEvents.removeAll()
        copy.forEach { emitNativeEvent(type:$0.0,payload:$0.1) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "https" && url.host == allowedHost { decisionHandler(.allow); return }
        if url.scheme == "https" { UIApplication.shared.open(url) }
        decisionHandler(.cancel)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "sceneshop", webView.url?.host == allowedHost, let body = message.body as? [String: Any], let type = (body["type"] as? String)?.uppercased(), allowed.contains(type) else { return }
        let requestId = body["requestId"] as? String ?? ""; let payload = body["payload"] as? [String: Any] ?? [:]
        if type == "NOTIFICATION_PERMISSION" || type == "NOTIFICATION_REGISTER" {
            handleNotificationRequest(type:type, requestId:requestId); return
        }
        do {
            var value: Any? = nil
            switch type {
            case "NATIVE_READY": value = ["platform":"ios"]
            case "OPEN_EXTERNAL": guard let raw=payload["url"] as? String,let url=URL(string:raw),url.scheme=="https" else{throw NSError(domain:"SceneShopBridge",code:1)};UIApplication.shared.open(url);value=true
            case "SHARE": present(UIActivityViewController(activityItems:[payload["title"],payload["url"]].compactMap{$0},applicationActivities:nil),animated:true);value=true
            case "SECURE_SET": try SceneShopSecureStore.set(payload["key"] as? String ?? "",value:payload["value"] as? String ?? "");value=true
            case "SECURE_GET": value=try SceneShopSecureStore.get(payload["key"] as? String ?? "")
            case "SECURE_DELETE": try SceneShopSecureStore.delete(payload["key"] as? String ?? "");value=true
            case "DEVICE_CONTEXT": value=["platform":"ios","systemVersion":UIDevice.current.systemVersion,"model":UIDevice.current.model]
            default: break
            }
            if !requestId.isEmpty { respond(requestId:requestId,ok:true,value:value,error:nil) }
        } catch { if !requestId.isEmpty { respond(requestId:requestId,ok:false,value:nil,error:error.localizedDescription) } }
    }

    private func handleNotificationRequest(type:String, requestId:String) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let current:[String:Any] = ["supported":true,"granted":settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional,"status":settings.authorizationStatus.rawValue]
            if type == "NOTIFICATION_PERMISSION" {
                if !requestId.isEmpty { self.respond(requestId:requestId,ok:true,value:current,error:nil) }
                return
            }
            UNUserNotificationCenter.current().requestAuthorization(options:[.alert,.badge,.sound]) { granted,error in
                var value:[String:Any] = ["supported":true,"granted":granted,"registration":granted ? "PERMISSION_GRANTED" : "PERMISSION_DENIED","tokenProvider":"APNS"]
                if let error=error { value["error"]=error.localizedDescription }
                DispatchQueue.main.async {
                    if granted { UIApplication.shared.registerForRemoteNotifications() }
                    if !requestId.isEmpty { self.respond(requestId:requestId,ok:true,value:value,error:nil) }
                    self.emitNativeEvent(type:"NOTIFICATION_REGISTRATION",payload:value)
                }
            }
        }
    }

    private func respond(requestId:String,ok:Bool,value:Any?,error:String?) {
        let response:[String:Any?]=["version":1,"requestId":requestId,"ok":ok,"value":value,"error":error]
        let object=response.compactMapValues{$0};guard JSONSerialization.isValidJSONObject(object),let data=try? JSONSerialization.data(withJSONObject:object),let json=String(data:data,encoding:.utf8) else{return}
        DispatchQueue.main.async { self.webView.evaluateJavaScript("window.SceneShopNativeResolve(\(json))") }
    }

    func emitLifecycle(_ state:String) { emitNativeEvent(type:"APP_LIFECYCLE",payload:["state":state]) }

    func emitNativeEvent(type:String,payload:[String:Any]=[:]) {
        guard pageReady, webView != nil else { pendingEvents.append((type,payload)); return }
        let event:[String:Any] = ["version":1,"type":type,"payload":payload,"at":Int(Date().timeIntervalSince1970*1000)]
        guard JSONSerialization.isValidJSONObject(event),let data=try? JSONSerialization.data(withJSONObject:event),let json=String(data:data,encoding:.utf8) else{return}
        DispatchQueue.main.async { self.webView.evaluateJavaScript("window.SceneShopNativeEvent(\(json))") }
    }

    func open(deepLink: URL) {
        if deepLink.scheme == "sceneshop", deepLink.host == "share" {
            let components=URLComponents(url:deepLink,resolvingAgainstBaseURL:false)
            let values=Dictionary(uniqueKeysWithValues:(components?.queryItems ?? []).map{($0.name,$0.value ?? "")})
            emitNativeEvent(type:"SHARE_RECEIVED",payload:["text":values["text"] ?? "","url":values["url"] ?? ""])
            return
        }
        var components=URLComponents(url:baseURL,resolvingAgainstBaseURL:false)!
        let parts=deepLink.pathComponents.filter{$0 != "/"}
        if deepLink.scheme == "https", deepLink.host == allowedHost, parts.count >= 2, parts[0] == "s" {
            components.queryItems=[URLQueryItem(name:"code",value:parts[1].uppercased())]
        } else if deepLink.scheme == "sceneshop", deepLink.host == "session", let code=parts.first {
            components.queryItems=[URLQueryItem(name:"code",value:code.uppercased())]
        } else {
            components.queryItems=[URLQueryItem(name:"source",value:deepLink.absoluteString)]
        }
        if let url=components.url { pageReady=false; webView?.load(URLRequest(url:url)) }
    }
}
