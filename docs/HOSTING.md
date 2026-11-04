# Web hosting

The web UI and API run as one Node service, with financial data persisted in the
dedicated Supabase project. Render configuration is managed through the service
settings, not a Blueprint.

- Runtime: Node 24.22.1, pnpm 11.25.0.
- Build: `bash scripts/build-hosted.sh`.
- Start: `pnpm --filter @yapesa/api start`.
- Plan: Free, Frankfurt, one instance, no attached disk or new database.
- Release source: `main`; use the review branch only before its release merge.
- Health: `/health`; use `/api/session` to check authentication configuration.

Server environment variables: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`PIN_PEPPER`, `AUTH_GATEWAY_KEY`, `SESSION_COOKIE_KEY`, `NODE_ENV=production`,
`NODE_VERSION=24.22.1`, `API_HOST=0.0.0.0`, `SERVE_WEB=true`,
`TRUSTED_PROXY_HOPS=1`, and `SKIP_INSTALL_DEPS=true`. The exact allowed web origin
defaults to Render's `RENDER_EXTERNAL_URL`; set `WEB_ORIGIN` explicitly if using a
custom domain. Keep secrets in Render settings. The existing gateway key must
match its Supabase digest, and the PIN pepper must remain stable.

Only the built web directory is publicly served. API responses remain uncached
and use encrypted, secure, HttpOnly cookies. Staff authenticator checks and
database policies still apply. The trusted proxy setting assumes Render's single
ingress proxy and must be reviewed if adding another proxy/CDN.

Free services sleep when idle and share the workspace's free hours with existing
services. This is a development deployment; no paid plan is provisioned. Monitor
workspace usage before a production rollout.

## First administrator

An administrator provisions the invited Auth identity and matching person and
pending membership. Mark the invitation using administrator-controlled
`app_metadata.yapesa_activation = "pending"`. Keep the role inactive until the
phone and authenticator are verified. User metadata is never an invitation or
role authority.

At `/#live`, choose **First-time account setup**, request a code if needed, and
enter the SMS code and a new PIN privately in the app. The API uses the verified
user's token to update only that user's opaque provider password. It has no
service-role key and cannot create accounts or assign roles. Existing verified
authenticator factors block this invitation path. Finish authenticator enrollment
and verification before the project administrator activates the pending role.

SMS codes are requested only by an explicit button press. Failed or expired codes
never issue a browser session. If a failure occurs after phone confirmation, try
normal sign-in with the chosen PIN; otherwise an administrator must arrange
recovery. Phone confirmation alone does not activate a business membership.
