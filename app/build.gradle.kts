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
        versionCode = 2
        versionName = "1.2.0"
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
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
