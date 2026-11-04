# EgoSMS Auth bridge

The `egosms-auth` Edge Function delivers Supabase Auth verification messages via
EgoSMS. It does not replace the application's phone/PIN gateway or staff TOTP.

## Deployed function

Yapesa endpoint:
`https://acqefirtqmfxttgrjoxu.supabase.co/functions/v1/egosms-auth`

The function is deployed with user-JWT checking off because Auth HTTP hooks use
Standard Webhooks signatures instead. Unsigned, forged, expired and modified
requests are rejected. Do not remove signature verification or turn this into a
general-purpose SMS endpoint.

## Secrets and connection

In the Yapesa project's Edge Functions → Secrets, retain:

| Name                   | Purpose                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `EGOSMS_API_USERNAME`  | EgoSMS API username.                                                                             |
| `EGOSMS_API_PASSWORD`  | EgoSMS API password.                                                                             |
| `EGOSMS_SENDER_ID`     | Optional configured sender, such as `EgoSMS`. Omit or leave empty to use the provider's default. |
| `SEND_SMS_HOOK_SECRET` | The signing secret shared with the Auth Send SMS HTTP hook.                                      |

Create a Send SMS HTTP hook under Authentication → Auth Hooks and use the deployed
endpoint above. Generate its signing secret in Supabase and privately save the
same full value (`v1,whsec_...`) as `SEND_SMS_HOOK_SECRET`. Keep the value out of
chat, source files, screenshots and logs. Credential creation/entry must be done
by the administrator in the dashboard. Do not enable the hook until both sides
have the same secret. Then enable phone authentication with phone confirmations
on, retain disabled public signup, and leave paid phone MFA off.

The bridge intentionally fails closed when its signing or provider configuration
is absent. A deployed function alone does not mean Auth is connected. A final
delivery test needs an administrator-approved recipient number; no real SMS is
sent by the automated checks.

## Request and error handling

Only signed Auth payloads containing a valid international phone number and a
six-to-ten-digit OTP are accepted. The fixed HTTPS EgoSMS endpoint receives a
single `SendSms` JSON request. The leading `+` is removed from the number, and the
message body is constructed by the server. No caller-supplied message or API URL
is accepted. Redirects are rejected so credentials cannot be forwarded elsewhere.

The provider request times out after 3.5 seconds, within Auth's five-second HTTP
hook budget. Only an HTTP success with `Status: "OK"` returns `{}` to Auth.
Provider errors and transport failures return generic errors without exposing
credentials, numbers or OTPs. There is no automatic delivery retry: a transport
error can occur after a message has already been accepted. Standard Webhooks
checks signature timestamps; durable cross-invocation SMS deduplication is not
implemented. Supabase Auth's SMS rate limits still apply.

## Verification

`pnpm test:sms` uses synthetic signing keys and mocked fetch only. It covers
signature failures, timestamp expiry, altered bodies, size/phone/code checks,
sender omission/override, missing configuration, provider rejection, malformed
responses, transport failure, no automatic retry and secret-free errors.
`pnpm check` includes these tests and strict function TypeScript checking.

The deployed GET endpoint returned 405 and unsigned POST returned 401. These are
negative security checks, not evidence of real SMS delivery. The Auth hook is now
enabled, all four secret names are present, and phone confirmation is enabled with
public signup disabled. One approved recipient's confirmation request was accepted
by Auth and recorded in `confirmation_sent_at`. Handset receipt and successful OTP
verification remain pending. Do not treat an accepted request as proof of delivery
or repeat it automatically. Enter codes only in the web application's first-time
setup screen, never in chat.

References:

- https://developers.pahappa.com/docs/sending-sms/api-specs-and-usage/
- https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook
- https://supabase.com/docs/guides/auth/auth-hooks
