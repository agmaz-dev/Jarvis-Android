plugins {
    id("com.android.application")
}

android {
    namespace = "de.agmaz.jarvis"
    compileSdk = 35

    defaultConfig {
        applicationId = "de.agmaz.jarvis"
        minSdk = 26
        targetSdk = 35
        // Jede Test-APK bekommt die Build-Nummer von GitHub, damit man sieht, welche Version installiert ist
        val build = (System.getenv("GITHUB_RUN_NUMBER") ?: "2").toInt()
        versionCode = build
        versionName = "1.2.$build"
        ndk {
            abiFilters += listOf("arm64-v8a")
        }
        externalNativeBuild {
            cmake {
                arguments += listOf("-DCMAKE_BUILD_TYPE=Release", "-DANDROID_STL=c++_shared")
                cppFlags += listOf("-O3")
            }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    // Fester Test-Schlüssel: So lassen sich neue Test-APKs als Update über die alte installieren.
    signingConfigs {
        getByName("debug") {
            storeFile = file("test-signing.keystore")
            storePassword = "android"
            keyAlias = "jarvistest"
            keyPassword = "android"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    // Die Oberflächen kommen 1:1 aus dem Ordner web/ (derselbe Code wie die Web-Version)
    sourceSets {
        getByName("main") {
            assets.srcDirs("../web")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources {
            // Die Mail-Bibliothek braucht ihre META-INF/javamail.*-Dateien, nur doppelte Lizenzdateien zusammenführen
            pickFirsts += listOf("META-INF/LICENSE.md", "META-INF/NOTICE.md", "META-INF/LICENSE", "META-INF/NOTICE")
        }
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.sun.mail:android-mail:1.6.7")
    implementation("com.sun.mail:android-activation:1.6.7")
}
