plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }

val releaseKeystoreFile = System.getenv("SCENESHOP_ANDROID_KEYSTORE_FILE")
val releaseStorePassword = System.getenv("SCENESHOP_ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = System.getenv("SCENESHOP_ANDROID_KEY_ALIAS")
val releaseKeyPassword = System.getenv("SCENESHOP_ANDROID_KEY_PASSWORD")
val releaseSigningReady = listOf(releaseKeystoreFile, releaseStorePassword, releaseKeyAlias, releaseKeyPassword).all { !it.isNullOrBlank() }

android {
  namespace = "io.sceneshop.mobile"
  compileSdk = 35
  defaultConfig { applicationId = "io.sceneshop.mobile"; minSdk = 26; targetSdk = 35; versionCode = 6; versionName = "0.19.0-rc.1" }
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
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions {
    jvmTarget = "17"
  }
}
android.defaultConfig.buildConfigField("String", "SCENESHOP_APP_URL", "\"${System.getenv("SCENESHOP_APP_URL") ?: "https://sceneshop.qonsult.cc"}\"")
android.buildFeatures.buildConfig = true
