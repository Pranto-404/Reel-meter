import com.android.build.api.artifact.SingleArtifact
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    // A WORKING id. The final application id is confirmed at the first Play upload (ROADMAP, open decision 2)
    // and never changes after that.
    namespace = "io.github.pranto404.reelity"
    compileSdk = 37 // required by the Compose libraries in the BOM; the app still targets 36

    defaultConfig {
        applicationId = "io.github.pranto404.reelity"
        minSdk = 26
        targetSdk = 36
        versionCode = providers.gradleProperty("VERSION_CODE").get().toInt()
        versionName = providers.gradleProperty("VERSION_NAME").get()
    }

    signingConfigs {
        getByName("debug") {
            // The shared debug key (not secret, debug builds only) once it is committed; until then the default one.
            val shared = file("debug.keystore")
            if (shared.exists()) {
                storeFile = shared
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        debug {
            // Installs next to the Play build, and each CI debug APK installs over the previous one.
            applicationIdSuffix = ".debug"
        }
        release {
            // Unsigned here; android-release.yml signs it with the upload key.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

    androidResources {
        // English and Bangla only, also for library strings.
        localeFilters += listOf("en", "bn")
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }

    lint {
        error += "HardcodedText"
        error += "MissingTranslation"
    }
}

dependencies {
    implementation(project(":core"))
    implementation(platform(libs.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui)

    testImplementation(libs.junit)
}

// Privacy check (ARCHITECTURE section 11): reads the merged manifest of the release build and fails the build if
// the app asks for any permission, allows backups, or exports anything but the launcher activity.
abstract class PrivacyCheck : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val mergedManifest: RegularFileProperty

    @get:Input
    abstract val applicationId: Property<String>

    @get:Input
    abstract val namespace: Property<String>

    @TaskAction
    fun check() {
        val androidNs = "http://schemas.android.com/apk/res/android"
        val doc = DocumentBuilderFactory.newInstance()
            .apply { isNamespaceAware = true }
            .newDocumentBuilder()
            .parse(mergedManifest.get().asFile)

        fun elements(tag: String): List<Element> =
            doc.getElementsByTagName(tag).let { nodes -> (0 until nodes.length).map { nodes.item(it) as Element } }

        fun Element.attr(name: String): String = getAttributeNS(androidNs, name)

        val problems = mutableListOf<String>()

        // The only permission allowed is the signature-level one AndroidX core declares for its own receivers
        // (ARCHITECTURE section 3). Users never see it; nothing outside the app can hold it.
        val allowedPermissions = setOf("${applicationId.get()}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION")
        val permissionTags =
            listOf("uses-permission", "uses-permission-sdk-23", "permission", "permission-group", "permission-tree")
        for (tag in permissionTags) {
            for (element in elements(tag)) {
                val name = element.attr("name")
                if (name !in allowedPermissions) problems += "<$tag android:name=\"$name\"> is not allowed"
            }
        }

        val application = elements("application").single()
        if (application.attr("allowBackup") != "false") problems += "android:allowBackup must be \"false\""
        if (application.attr("dataExtractionRules").isEmpty()) problems += "android:dataExtractionRules is missing"

        val launcher = setOf(".MainActivity", "${namespace.get()}.MainActivity")
        for (tag in listOf("activity", "activity-alias", "service", "receiver", "provider")) {
            for (element in elements(tag)) {
                val name = element.attr("name")
                if (element.attr("exported") == "true" && !(tag == "activity" && name in launcher)) {
                    problems += "<$tag android:name=\"$name\"> must not be exported"
                }
            }
        }

        if (problems.isNotEmpty()) {
            throw GradleException(
                "Privacy check failed for ${mergedManifest.get().asFile}:\n" + problems.joinToString("\n") { "  - $it" },
            )
        }
        logger.lifecycle("Privacy check passed: no permissions, no backup, only MainActivity exported.")
    }
}

androidComponents {
    onVariants(selector().withBuildType("release")) { variant ->
        val privacyCheck = tasks.register<PrivacyCheck>("privacyCheck") {
            group = "verification"
            description = "Checks permissions, backup and exported components in the merged release manifest."
            mergedManifest.set(variant.artifacts.get(SingleArtifact.MERGED_MANIFEST))
            applicationId.set(variant.applicationId)
            namespace.set(variant.namespace)
        }
        tasks.named("check") { dependsOn(privacyCheck) }
    }
}
