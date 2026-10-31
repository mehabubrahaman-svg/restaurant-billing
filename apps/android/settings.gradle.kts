pluginManagement {
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}

dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    google()
    mavenCentral()
  }
}

rootProject.name = "RestroOS"

// `core` is plain Kotlin (no Android SDK), so its tests run anywhere with a JDK.
include(":core")
if (System.getenv("RESTRO_CORE_ONLY") != "1") include(":app")
