plugins {
	id("com.android.application")
	id("org.jetbrains.kotlin.plugin.compose")
}

android {
	namespace = "za.co.proteabank.authenticator"
	compileSdk = 36
	defaultConfig {
		applicationId = "za.co.proteabank.authenticator"
		minSdk = 28
		targetSdk = 36
		versionCode = 1
		versionName = "0.1.0"
		testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
	}
	buildTypes { release { isMinifyEnabled = false } }
	compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
	buildFeatures { compose = true }
	testOptions { unitTests.isReturnDefaultValues = true }
}

dependencies {
	implementation(platform("androidx.compose:compose-bom:2026.04.01"))
	implementation("androidx.compose.material3:material3")
	implementation("androidx.compose.ui:ui")
	implementation("androidx.activity:activity-compose:1.13.0")
	implementation("androidx.biometric:biometric:1.1.0")
	implementation("androidx.fragment:fragment-ktx:1.9.1")
	implementation("androidx.camera:camera-camera2:1.6.2")
	implementation("androidx.camera:camera-lifecycle:1.6.2")
	implementation("androidx.camera:camera-view:1.6.2")
	implementation("com.google.mlkit:barcode-scanning:17.3.0")
	testImplementation("junit:junit:4.13.2")
	testImplementation("org.json:json:20250517")
	androidTestImplementation("androidx.test.ext:junit:1.3.0")
	androidTestImplementation("androidx.test:runner:1.7.0")
}
