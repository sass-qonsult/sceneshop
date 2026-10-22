plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }

val releaseKeystoreFile = System.getenv("SCENESHOP_ANDROID_KEYSTORE_FILE")
val releaseStorePassword = System.getenv("SCENESHOP_ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = System.getenv("SCENESHOP_ANDROID_KEY_ALIAS")
val releaseKeyPassword = System.getenv("SCENESHOP_ANDROID_KEY_PASSWORD")
val releaseSigningReady = listOf(releaseKeystoreFile, releaseStorePassword, releaseKeyAlias, releaseKeyPassword).all { !it.isNullOrBlank() }

android {
  namespace = "io.sceneshop.mobile"
  compileSdk = 35
  defaultConfig { applicationId = "io.sceneshop.mobile"; minSdk = 26; targetSdk = 35; versionCode = 7; versionName = "0.19.0-rc.1" }
  signingConfigs {
    if (releaseSigningReady) create("production") {
      storeFile = file(releaseKeystoreFile!!)
      storePassword = releaseStorePassword
      keyAlias = releaseKeyAlias
      keyPassword = releaseKeyPassword
    }
  }
  buildTypes {
    getByName("release") { if (releaseSigningReady) signingConfig = signingConfigs.getByName("production") }
  }
}
android.defaultConfig.buildConfigField("String", "SCENESHOP_APP_URL", "\"${System.getenv("SCENESHOP_APP_URL") ?: "https://app.sceneshop.io"}\"")
android.buildFeatures.buildConfig = true

// rcprep.16: Payment Request no WebView (Google Pay / cartões da Carteira do Google dentro do app)
dependencies { implementation("androidx.webkit:webkit:1.14.0") }
