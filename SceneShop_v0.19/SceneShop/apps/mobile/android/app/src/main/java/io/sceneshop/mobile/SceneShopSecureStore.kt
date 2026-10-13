package io.sceneshop.mobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SceneShopSecureStore(private val context: Context) {
  private val alias = "SceneShopMobileSecureStore"
  private val prefs = context.getSharedPreferences("sceneshop_secure", Context.MODE_PRIVATE)
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
      init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
      generateKey()
    }
  }
  fun set(name: String, value: String) {
    require(name.matches(Regex("^[A-Za-z0-9._:-]{1,96}$")))
    val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key())
    val packed = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    prefs.edit().putString(name, Base64.encodeToString(packed, Base64.NO_WRAP)).apply()
  }
  fun get(name: String): String? {
    val raw = prefs.getString(name, null) ?: return null
    val packed = Base64.decode(raw, Base64.NO_WRAP); require(packed.size > 12)
    val iv = packed.copyOfRange(0, 12); val encrypted = packed.copyOfRange(12, packed.size)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
    return String(cipher.doFinal(encrypted), Charsets.UTF_8)
  }
  fun delete(name: String) { prefs.edit().remove(name).apply() }
}
