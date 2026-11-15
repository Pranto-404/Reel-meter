// Declared once here so every module shares one class loader (and one Kotlin Gradle plugin version).
// AGP 9 compiles Kotlin itself ("built-in Kotlin"), so there is no kotlin-android plugin; declaring kotlin-jvm here
// also lifts the Kotlin version AGP uses from its bundled minimum to the one in the version catalog.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
