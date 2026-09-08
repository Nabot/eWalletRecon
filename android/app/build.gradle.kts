plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.ewallet.capture"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.ewallet.capture"
        minSdk = 26
        targetSdk = 35
        versionCode = 8
        versionName = "1.3.4"
        buildConfigField("String", "DEFAULT_API_BASE", "\"http://10.0.2.2:3001\"")
        buildConfigField("boolean", "ALLOW_CLEARTEXT", "true")
        buildConfigField("boolean", "ALLOW_EDIT_API_BASE", "true")
        manifestPlaceholders["usesCleartextTraffic"] = "true"
    }

    flavorDimensions += "env"
    productFlavors {
        create("dev") {
            dimension = "env"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            // Override for physical devices: -Pewallet.apiBase=http://192.168.x.x:3001
            val devBase = (project.findProperty("ewallet.apiBase") as String?)
                ?: "http://10.0.2.2:3001"
            buildConfigField("String", "DEFAULT_API_BASE", "\"$devBase\"")
            buildConfigField("boolean", "ALLOW_CLEARTEXT", "true")
            buildConfigField("boolean", "ALLOW_EDIT_API_BASE", "true")
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        create("prod") {
            dimension = "env"
            // Override at build time: -Pewallet.apiBase=https://api.example.com
            val prodBase = (project.findProperty("ewallet.apiBase") as String?)
                ?: "https://api.example.com"
            buildConfigField("String", "DEFAULT_API_BASE", "\"$prodBase\"")
            buildConfigField("boolean", "ALLOW_CLEARTEXT", "false")
            buildConfigField("boolean", "ALLOW_EDIT_API_BASE", "false")
            manifestPlaceholders["usesCleartextTraffic"] = "false"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    implementation("com.journeyapps:zxing-android-embedded:4.3.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
