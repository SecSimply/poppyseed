import java.util.Properties

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
	// The release key lives outside the repository, in ~/.protea-app (or where PROTEA_KEYSTORE_PROPERTIES points). Without it, a release build is unsigned.
	val keystoreProperties = Properties().apply {
		val file = File(System.getenv("PROTEA_KEYSTORE_PROPERTIES") ?: "${System.getProperty("user.home")}/.protea-app/keystore.properties")
		if (file.exists()) file.inputStream().use { load(it) }
	}
	signingConfigs {
		if (keystoreProperties.containsKey("storeFile")) create("release") {
			storeFile = file(keystoreProperties.getProperty("storeFile"))
			storePassword = keystoreProperties.getProperty("storePassword")
			keyAlias = keystoreProperties.getProperty("keyAlias")
			keyPassword = keystoreProperties.getProperty("keyPassword")
		}
	}
	buildTypes { release { isMinifyEnabled = true; isShrinkResources = true; proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"); signingConfig = signingConfigs.findByName("release") } }
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
