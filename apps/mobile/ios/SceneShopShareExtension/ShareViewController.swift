import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        consumeShare()
    }

    private func consumeShare() {
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
            provider.loadItem(forTypeIdentifier: UTType.url.identifier, options:nil) { item,_ in self.finish(url:item as? URL,text:nil) }; return
        }
        if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options:nil) { item,_ in self.finish(url:nil,text:item as? String) }; return
        }
        finish(url:nil,text:nil)
    }

    private func finish(url:URL?,text:String?) {
        var parts=URLComponents();parts.scheme="sceneshop";parts.host="share";parts.queryItems=[URLQueryItem(name:"url",value:url?.absoluteString),URLQueryItem(name:"text",value:text)].filter{$0.value != nil}
        guard let target=parts.url else { extensionContext?.completeRequest(returningItems:nil); return }
        extensionContext?.open(target) { _ in self.extensionContext?.completeRequest(returningItems:nil) }
    }
}
