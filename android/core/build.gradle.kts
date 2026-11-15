import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Pure Kotlin: the port of extension/src/core.js. Being a JVM module keeps Android APIs out by construction.
plugins {
    alias(libs.plugins.kotlin.jvm)
}

// Java 17 bytecode, the same level as :app, whatever JDK (17 or newer) runs Gradle.
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    testImplementation(libs.junit)
}

tasks.test {
    useJUnit()
}
