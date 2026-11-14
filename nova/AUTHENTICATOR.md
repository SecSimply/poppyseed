# The Protea authenticator: what the app and the bank say to each other

A customer enrolls a phone once. From then on, every payment or transfer an agent asks for waits for that phone, which shows what is being asked, takes the customer's fingerprint and signs an approval. The bank performs it only for a valid signature. The agent cannot approve (the bank refuses its confirmation even when it claims the customer's approval), and neither can the bank's website.

This is the bank's own protocol, not part of the Personal Agent Protocol. The code is `lib/authenticator.ts` (routes), `lib/device-auth.ts` (who is in the app, and signatures), `lib/phone-signin.ts` (the bank's calls to the device auth service) and `lib/devices.ts` (the store). `lib/fake-phone.ts` is a phone and a stand-in for the service, for tests, and `protea-app/` is the Android app.

## Who is in the app, and what is approved

Two things are kept apart. **Who is in the app** is the device auth service's to say (its own repository, `SecSimply/device-auth-service`): the phone unlocks a sign-in key with the fingerprint and gets a short session from the service, and sends it to the bank as `Authorization: Bearer <session>`. **What was approved** is the bank's: the approval key signs exactly one operation. The phone makes **two** P-256 key pairs in the Android Keystore (StrongBox when there is one) and never lets either leave. Both need the fingerprint every time (`setUserAuthenticationRequired(true)`, no validity window, invalidated when a fingerprint is added):

| Key | Kept by | Signs |
| --- | --- | --- |
| **sign-in key** | the device auth service (it holds the public key) | the service's challenge, to unlock the app (`DEVAUTH-V1\nauth\n…`) and to register |
| **approval key** | the bank | an approval of one operation, and the request for the sign-in code |

Signatures are ECDSA with SHA-256. The bank accepts the 64 bytes `r‖s`, or ASN.1 DER, which is what Android's `Signature` gives; it tells them apart by length. The bank's public key is sent as a JWK: `{"kty":"EC","crv":"P-256","x":"…","y":"…"}`, with `x` and `y` 43 base64url characters.

## Enrolling

1. The customer signs in at the bank's website, opens **Account**, and presses **Add my phone**. The page shows a QR code that holds this link, valid for 5 minutes and usable once:

   `protea://enroll?o=<bank origin>&e=<enrollment id>&s=<secret>`

2. The app scans it, makes the approval key pair, and sends:

   `POST {o}/authenticator/enroll`, `content-type: application/json`

   ```json
   { "enrollment_id": "enr_…", "secret": "…", "name": "Pixel 8", "approval_key": { "kty": "EC", … } }
   ```

   `name` is 1 to 40 characters. The answer is `201`:

   ```json
   { "device_id": "dev_…", "code": "123456", "origin": "https://sandbox.proteabank.co.za", "customer": "Thandi Nkosi" }
   ```

   Every failure (a wrong or spent secret, an expired enrollment, a customer who already has a device) is the same `400 invalid_enrollment`, so a bad guess learns nothing.

3. The app shows `code` and the customer's name. The website shows the same code and asks whether it matches. **The device works only after the customer presses "The codes match"**, within 5 minutes. Until then the bank gives it nothing.

4. **Setting up the app.** The phone is not usable until it is also registered with the device auth service, which the bank requires for every request after this:
   - The phone asks `POST {o}/authenticator/signin-code` with `{"device_id", "nonce", "time", "signature"}`. The approval key signs `PROTEA-SIGNIN-CODE-V1\n<bank origin>\n<device_id>\n<nonce>\n<time>` (the fingerprint), once, within 2 minutes of the bank's clock. Only a confirmed phone gets an answer (a waiting one is `401`, so the code is never in the QR code): `200 {"origin": "https://…", "code": "enr_….…", "expires_at": "…"}`, a one-time code for the service at `origin`, good for ten minutes. The bank notes which code it made for this phone. `409 already_set_up` if the phone is bound already, `409 too_many_phones`, `503` if the service is down.
   - The phone registers at the service with the code and its sign-in key (the service's own protocol: its README), with one more fingerprint.
   - The first session the phone unlocks binds it: the bank asks the service which device registered with the code it made, and accepts only that device's sessions for this phone from then on. Another phone registered at the service for the same customer is not this app.

A customer has one device. To replace it, a staff member removes it in the console (its registrations at the service are revoked too), and the customer enrolls again.

## Every other request

Every request except enrollment and the sign-in code carries the service's session: `Authorization: Bearer <session>`. To get one the app asks the service for a challenge, signs it with the sign-in key after the fingerprint and sends it back (`/v1/auth/challenge`, `/v1/auth/verify`: the service's README). The session lives in the app's memory only and runs out after the service's `Auth__SessionSeconds`; the app also forgets it when it goes to the background, so the fingerprint is asked for again.

The bank sends the session to the service (`GET /v1/whoami`), which says which device and customer it is. The bank accepts it only for that customer's active device, and only if the session's device is the one bound to the phone. A request that fails this is `401 invalid_device_request`; `503 signin_unavailable` means the service could not be asked, and the app shows nothing rather than guess.

## What is waiting

`GET /authenticator/operations` answers `{"operations": [...]}`; `GET /authenticator/operations/{id}` answers one operation. Each is:

```json
{
  "operation_id": "op_…", "revision": 1, "state": "proposed",
  "summary": "Pay R10,00 to Boland Power (account ending 7741) from Everyday Cheque Account ••4821. The money leaves today and can't be recalled. The customer must approve it in the Protea app on their phone.",
  "terms": { "payee_id": "pye_thandi_energy", "from_account_id": "acc_thandi_everyday", "amount": { "amount": "10.00", "currency": "ZAR" } },
  "terms_hash": "…", "expires_at": "2026-11-10T16:00:00.000Z",
  "agent": { "client_id": "https://agent.proteabank.co.za/client.json", "name": "Claude bridge" }
}
```

Show the customer the agent's name, the `summary` and the amount and payee from `terms`. Another customer's operation is a `404`, the same as one that does not exist.

## Approving

`POST /authenticator/operations/{id}/approve`, a signed request whose body is:

```json
{ "revision": 1, "approval": { "signature": "…", "nonce": "…", "time": "1731254400000" } }
```

The approval is a **second signature, made with the approval key after the fingerprint**, over these eight lines joined by `\n`:

```
PROTEA-APPROVE-V1
<the bank's origin, such as https://sandbox.proteabank.co.za>
<device_id>
<operation_id>
<revision>
<terms hash>
<approval nonce>
<approval time>
```

The **terms hash** is what the phone computes from the `summary` and `terms` it is showing, not the `terms_hash` field the bank sent (compare them, and refuse to sign if they differ): `base64url(SHA-256(canonical({"summary": summary, "terms": terms})))`. `canonical` is JSON with every object's keys sorted by UTF-16 code unit (JavaScript's default sort), at every level, and no spaces; strings, numbers and other values are written as `JSON.stringify` writes them (control characters as `\b \f \n \r \t` or `\u00xx` in lower case, `"` and `\` escaped, everything else as UTF-8).

A good approval is `200` with `{"operation": …}`; the bank performs the payment at once. Refusals: `401` (no accepted sign-in: the session ran out, or the phone was removed or not confirmed), `403 invalid_approval` (the signature is not the approval key's for exactly this operation, revision and terms), `403 replayed_approval`, `404 operation_not_found`, `409 not_open` (already decided or expired) and `409 terms_changed` (a newer revision exists: read it again and ask the customer again).

## Declining

`POST /authenticator/operations/{id}/decline` with an empty body. It needs the unlocked app but no second fingerprint, because turning a payment down is always safe.

## The app

`protea-app/` (Kotlin, Jetpack Compose, minSdk 28) follows everything above. Its tests check it against `protea-app/app/src/test/resources/vectors.json`, which the bank writes from its own code (`scripts/authenticator-vectors.ts`): the canonical JSON, the terms hash, the approval and sign-in-code texts and a signature. Run that script again after any change to `lib/device-auth.ts`.

- **Where it looks:** while the app is open and unlocked it asks for waiting operations every 5 seconds. There are no push messages, so a closed app sees nothing.
- **What it refuses to do:** it signs only the hash it computes itself from the summary and terms on screen, and only when that equals the `terms_hash` the bank sent. It talks only to the origin in the QR code, over https, and shows that address before it enrolls.
- **After a new fingerprint is added** to the phone, the approval key stops working for good. The app says so and offers to forget the phone; a staff member removes it at the bank and the customer enrolls again.
- **No Google services are needed**: the QR scanner uses ML Kit's bundled model.

## Trying it without the app

There is no command-line phone any more: signing in needs the device auth service. Its simulator (`dotnet run --project src/DeviceAuth.Simulator`, in its repository) covers the service's half, and `lib/fake-phone.ts` with its stand-in service covers the whole flow in tests (`lib/authenticator.test.ts`, `lib/phone-flow.test.ts`).
