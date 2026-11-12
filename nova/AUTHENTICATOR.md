# The Protea authenticator: what the app and the bank say to each other

A customer enrolls a phone once. From then on, every payment or transfer an agent asks for waits for that phone, which shows what is being asked, takes the customer's fingerprint and signs an approval. The bank performs it only for a valid signature. The agent cannot approve (the bank refuses its confirmation even when it claims the customer's approval), and neither can the bank's website.

This is the bank's own protocol, not part of the Personal Agent Protocol. The code is `lib/authenticator.ts` (routes), `lib/device-auth.ts` (signatures) and `lib/devices.ts` (the store). `scripts/fake-phone.ts` is a phone on the command line that follows everything below.

## Keys

The phone makes **two** P-256 key pairs in the Android Keystore (StrongBox when there is one) and never lets either leave:

| Key | Signs | Unlocked by |
| --- | --- | --- |
| **auth key** | every request to the bank | nothing, so the app can look for waiting approvals in the background |
| **approval key** | an approval of one operation | the fingerprint, every time (`setUserAuthenticationRequired(true)`, no validity window, invalidated when a fingerprint is added) |

Signatures are ECDSA with SHA-256, written base64url (no padding). The bank accepts the 64 bytes `r‖s`, or ASN.1 DER, which is what Android's `Signature` gives; it tells them apart by length. Public keys are sent as JWKs: `{"kty":"EC","crv":"P-256","x":"…","y":"…"}`, with `x` and `y` 43 base64url characters.

## Enrolling

1. The customer signs in at the bank's website, opens **Account**, and presses **Add my phone**. The page shows a QR code that holds this link, valid for 5 minutes and usable once:

   `protea://enroll?o=<bank origin>&e=<enrollment id>&s=<secret>`

2. The app scans it, makes the two key pairs, and sends:

   `POST {o}/authenticator/enroll`, `content-type: application/json`

   ```json
   { "enrollment_id": "enr_…", "secret": "…", "name": "Pixel 8", "auth_key": { "kty": "EC", … }, "approval_key": { "kty": "EC", … } }
   ```

   `name` is 1 to 40 characters. The keys must differ. The answer is `201`:

   ```json
   { "device_id": "dev_…", "code": "123456", "origin": "https://app.proteabank.co.za", "customer": "Thandi Nkosi" }
   ```

   Every failure (a wrong or spent secret, an expired enrollment, a customer who already has a device) is the same `400 invalid_enrollment`, so a bad guess learns nothing.

3. The app shows `code` and the customer's name. The website shows the same code and asks whether it matches. **The device works only after the customer presses "The codes match"**, within 5 minutes. Until then every request from it is refused.

A customer has one device. To replace it, a staff member removes it in the console, and the customer enrolls again.

## Signing a request

Every request except enrollment carries four headers:

| Header | Value |
| --- | --- |
| `x-device-id` | the `device_id` from enrollment |
| `x-device-time` | milliseconds since 1970, within 2 minutes of the bank's clock |
| `x-device-nonce` | up to 100 characters (random bytes in base64url), new for every request |
| `x-device-signature` | the auth key's signature of the text below |

The signed text is these seven lines joined by `\n`, with no final newline:

```
PROTEA-DEVICE-V1
<METHOD, upper case>
<the bank's host, such as app.proteabank.co.za>
<path and query exactly as sent, such as /authenticator/operations>
<x-device-time>
<x-device-nonce>
<base64url of the SHA-256 of the request body bytes; the empty body for GET>
```

A request works once: the bank remembers each nonce, and checks the signature before it takes the nonce.

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
<the bank's origin, such as https://app.proteabank.co.za>
<device_id>
<operation_id>
<revision>
<terms hash>
<approval nonce>
<approval time>
```

The **terms hash** is what the phone computes from the `summary` and `terms` it is showing, not the `terms_hash` field the bank sent (compare them, and refuse to sign if they differ): `base64url(SHA-256(canonical({"summary": summary, "terms": terms})))`. `canonical` is JSON with every object's keys sorted by UTF-16 code unit (JavaScript's default sort), at every level, and no spaces; strings, numbers and other values are written as `JSON.stringify` writes them (control characters as `\b \f \n \r \t` or `\u00xx` in lower case, `"` and `\` escaped, everything else as UTF-8).

A good approval is `200` with `{"operation": …}`; the bank performs the payment at once. Refusals: `401` (the request is not signed by an enrolled device, the clock is off, or the request was already used), `403 invalid_approval` (the signature is not the approval key's for exactly this operation, revision and terms), `403 replayed_approval`, `404 operation_not_found`, `409 not_open` (already decided or expired) and `409 terms_changed` (a newer revision exists: read it again and ask the customer again).

## Declining

`POST /authenticator/operations/{id}/decline` with an empty body, signed with the auth key. It needs no fingerprint, because turning a payment down is always safe.

## Trying it without the app

```
node --experimental-strip-types --no-warnings nova/scripts/fake-phone.ts enroll "protea://enroll?o=…&e=…&s=…"
node --experimental-strip-types --no-warnings nova/scripts/fake-phone.ts list
node --experimental-strip-types --no-warnings nova/scripts/fake-phone.ts approve op_…
```

The account page shows the link under the QR code ("Cannot scan?"). The command-line phone keeps its keys in `~/.protea-fake-phone.json`.
