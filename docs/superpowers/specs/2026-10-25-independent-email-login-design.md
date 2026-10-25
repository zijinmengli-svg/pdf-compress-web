# Independent Email Login Design

## Intent

Complete usable email-code sign-in before Paddle approval, without coupling authentication to credits, checkout, refunds, or compression limits. Existing anonymous PDF compression remains unchanged. The login control is available on both language homepages at all times.

## Approach

Considered reusing the payment branch's account service, but it requires reward wallets and payment migrations. Considered an external identity provider, but it adds cost and a second account configuration. Chosen: a small PostgreSQL-backed TinyPDF auth module on the deployed homepage commit, with Resend only as the email transport. A future payment release may link its records to the stable account ID after a separate migration.

## Behavior

- A visitor may request a six-digit code for a normalized email, enter it within ten minutes, and become signed in without registration or password.
- Email/code requests have a sixty-second resend cooldown, per-email and per-IP hourly limits, and at most five verification attempts. Errors do not reveal whether an account existed.
- A successful verification consumes the challenge, creates or reuses one account, and issues an opaque thirty-day, HttpOnly, SameSite=Lax cookie; HTTPS production adds Secure. Logout revokes the server session and clears the cookie.
- The header offers login whether or not a PDF is selected. When signed in it offers account details and logout. English and Chinese copy are checked independently. Login survives refresh and language navigation.
- Compression, the visual quota preview, and all payment-related behavior are untouched. No new login gate or free-credit issuance is introduced.

## Constraints

- Backend requires existing PostgreSQL, stable `WEB_SESSION_SECRET`, a Resend sending key, and verified `AUTH_FROM_EMAIL`. If incomplete, login reports unavailable but compression keeps working.
- Account tables use `auth_` names, independent of payment/referral tables. No API key or code is logged or exposed to clients beyond the email itself.
- POST endpoints require the site's existing web-session request token and same-origin checks. State-changing requests are bounded and JSON only.
- Production rollout is limited to this isolated branch after local and browser acceptance; `BILLING_ENABLED` remains false. No payment files are merged.
