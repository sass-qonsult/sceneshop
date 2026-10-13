import Foundation
import Security

enum SceneShopSecureStore {
    private static let service = "io.sceneshop.mobile.secure"
    private static func valid(_ key: String) -> Bool { key.range(of: "^[A-Za-z0-9._:-]{1,96}$", options: .regularExpression) != nil }
    static func set(_ key: String, value: String) throws {
        guard valid(key), let data = value.data(using: .utf8) else { throw NSError(domain: "SceneShopSecureStore", code: 1) }
        let base: [String: Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key]
        SecItemDelete(base as CFDictionary)
        var item = base; item[kSecValueData as String] = data; item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw NSError(domain: "SceneShopSecureStore", code: 2) }
    }
    static func get(_ key: String) throws -> String? {
        guard valid(key) else { throw NSError(domain: "SceneShopSecureStore", code: 1) }
        let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key,kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne]
        var result: CFTypeRef?; let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw NSError(domain: "SceneShopSecureStore", code: Int(status)) }
        return String(data:data, encoding:.utf8)
    }
    static func delete(_ key: String) throws {
        guard valid(key) else { throw NSError(domain: "SceneShopSecureStore", code: 1) }
        let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:key]
        let status = SecItemDelete(query as CFDictionary); guard status == errSecSuccess || status == errSecItemNotFound else { throw NSError(domain:"SceneShopSecureStore",code:Int(status)) }
    }
}
