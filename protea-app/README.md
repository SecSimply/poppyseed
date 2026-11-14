# Protea authenticator (Android)

The phone app for Protea Bank. A customer enrolls it once by scanning the QR code on the bank's Account page. After that, every payment an agent asks for waits here: the app shows who asks, how much and to whom, and the customer approves with a fingerprint or declines. The bank performs the payment only for the phone's signature. The protocol is in [`../nova/AUTHENTICATOR.md`](../nova/AUTHENTICATOR.md).

Kotlin, Jetpack Compose, minSdk 28. No Google services (CameraX and ML Kit's bundled QR model), no push messages: the app looks for waiting payments every 5 seconds while it is open, and not otherwise.

## Code

| Where | What |
| --- | --- |
| `core/` | Pure Kotlin: canonical JSON, the terms hash, the signed texts, key handling, the enrollment link and the operations model. Tested on the computer. |
| `device/` | The two Keystore keys (the auth key signs requests; the approval key needs the fingerprint each time) and the prompt that unlocks it. |
| `net/`, `store/` | Plain https, signed requests, and the device id kept on the phone. |
| `MainActivity.kt`, `QrScanner.kt` | The screens: scan, confirm the address, show the code, the waiting list, the detail with Approve and Decline. |

## Tests

```sh
./gradlew :app:testDebugUnitTest          # on the computer
./gradlew :app:connectedDebugAndroidTest  # on a connected phone (keys in the real Keystore, two requests to the live bank)
```

The unit tests check the app against `app/src/test/resources/vectors.json`, which the bank writes from its own code. After any change to `../nova/lib/device-auth.ts`, regenerate it:

```sh
cd ../nova && node --experimental-strip-types --no-warnings scripts/authenticator-vectors.ts
```

## Build and install

Needs JDK 17+ and the Android SDK (`local.properties` holds `sdk.dir`, and is not committed).

```sh
./gradlew :app:assembleDebug     # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleRelease   # signed with the release key, if there is one
adb install -r app/build/outputs/apk/release/app-release.apk
```

The release key is **not in the repository**. It is read from `~/.protea-app/keystore.properties` (or the file named by `PROTEA_KEYSTORE_PROPERTIES`), which names `~/.protea-app/release.jks`. Keep both safe: a release signed with another key cannot be installed over this one, and installing a differently signed app removes the old one, which deletes the phone's keys and means enrolling again (a staff member removes the old device at the bank first, in `/staff`, "Customers' phones"). Without the properties file, the release build is unsigned.

A debug and a release build are signed by different keys, so installing one over the other also means enrolling again.

## One setup for everything

The customer adds the phone once (the QR code on the Account page, then "The codes match" on the website). After that the app shows **Finish setting up**: it asks the bank (`POST /authenticator/signin-code`, signed like every request) for a one-time code for the [device auth service](https://github.com/SecSimply/device-auth-service), makes a third Keystore key (fingerprint on every use), signs `DEVAUTH-V1\nregister\n…` after one fingerprint, and registers its public key with the code. The bank hands the code over only to a confirmed phone, so the QR code alone gets nobody a sign-in. Signing in with that key is not built yet.

## Not done yet

- Push messages (Firebase or another service), so a closed app can tell the customer something is waiting.
- Device attestation, so the bank can know the keys are in genuine secure hardware.
- A fresh Curity sign-in when enrolling (by choice, for now).
