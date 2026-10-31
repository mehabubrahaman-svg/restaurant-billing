import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
  id("com.android.application")
  kotlin("android")
}

// CI passes the build number; a signed release needs the four RESTRO_* signing variables.
val versionCodeFromCi = System.getenv("RESTRO_VERSION_CODE")?.toIntOrNull() ?: 1
val keystore = System.getenv("RESTRO_KEYSTORE")?.let { file(it) }?.takeIf { it.exists() }

android {
  namespace = "app.restroos.client"
  compileSdk = 35

  defaultConfig {
    applicationId = "app.restroos.client"
    minSdk = 26
    targetSdk = 35
    versionCode = versionCodeFromCi
    versionName = "1.0.$versionCodeFromCi"
  }

  signingConfigs {
    if (keystore != null) {
      create("release") {
        storeFile = keystore
        storePassword = System.getenv("RESTRO_KEYSTORE_PASSWORD")
        keyAlias = System.getenv("RESTRO_KEY_ALIAS")
        keyPassword = System.getenv("RESTRO_KEY_PASSWORD")
      }
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      signingConfig = signingConfigs.findByName("release")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildFeatures { buildConfig = true }

  lint {
    // Bluetooth calls are guarded by Bluetooth.hasPermission(), which lint can't follow.
    disable += "MissingPermission"
    abortOnError = true
    warningsAsErrors = false
  }
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

dependencies { implementation(project(":core")) }
