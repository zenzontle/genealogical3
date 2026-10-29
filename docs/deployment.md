# Deployment

The app deploys to Vercel as a static Vite build plus one serverless function, `api/drive-auth/[action].ts`, which handles Google Drive authentication. Without Google configuration, everything except Drive works.

## Environment variables

Copy `.env.example` to `.env.local` for local development. On Vercel, set the same values in the project's environment variables. Restart Vite or redeploy after any change.

| Variable                | Exposed to browser | Purpose                                                                                                              |
| ----------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `VITE_GOOGLE_CLIENT_ID` | Yes                | Google OAuth client ID                                                                                               |
| `GOOGLE_CLIENT_SECRET`  | No                 | Google OAuth client secret                                                                                           |
| `DRIVE_APP_ORIGIN`      | No                 | Exact served origin, no trailing slash, such as `http://localhost:5173`                                              |
| `DRIVE_SESSION_KEY`     | No                 | 32 random bytes as 64 hex characters; encrypts the session cookie                                                    |
| `PUBLIC_APP_URL`        | Yes                | HTTPS origin of the deployment, with no path                                                                         |
| `PUBLIC_DEVELOPER_NAME` | Yes                | Developer name shown in the footer and legal pages                                                                   |
| `PUBLIC_REPOSITORY_URL` | Yes                | GitHub repository linked from the footer, used as the contact fallback                                               |
| `PRIVACY_CONTACT_EMAIL` | Published in pages | Contact email on the privacy and terms pages; if empty, the repository's issue tracker is the contact method instead |

Generate `DRIVE_SESSION_KEY` with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Never give server secrets a `VITE_` prefix, and never commit them. Invalid public URLs or emails stop startup and builds with a configuration error. Missing or invalid Drive settings don't stop the build; Drive actions fail at runtime with a configuration error (HTTP 503).

## Google Drive

1. Create a Google Cloud project, enable the Google Drive API, and configure the OAuth consent screen.
2. Create an OAuth **Web application** client. Add each served origin to Authorized JavaScript origins and `${DRIVE_APP_ORIGIN}/api/drive-auth/callback` to Authorized redirect URIs. Locally, use `http://localhost:5173` and `http://localhost:5173/api/drive-auth/callback`.
3. Set the four Drive variables above and restart Vite.
4. Publish the consent screen, or add test users for the accounts that will use Drive.

How it works:

- The app requests only the `drive.file` scope, so it sees only files it created.
- The server stores the refresh token in an encrypted, HttpOnly cookie. A connection lasts at most 30 days from authorization. Access tokens stay in browser memory, and tree data goes directly between the browser and Drive.
- OAuth projects in **Testing** status usually issue refresh tokens that expire after seven days. See [Google's token expiration docs](https://developers.google.com/identity/protocols/oauth2#expiration).
- `pnpm dev` and `pnpm exec vite preview` serve the same `/api/drive-auth/*` endpoints as Vercel. Keep the port fixed to match `DRIVE_APP_ORIGIN`: `pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort`. HTTP cookies are allowed only on localhost; deployments need HTTPS.

## Vercel

- Set all environment variables for each deployment environment, then redeploy. Every configuration change needs a new build.
- The auth function needs a Node runtime with native `fetch`; Node 22 is recommended.
- All instances must share one `DRIVE_SESSION_KEY`. Rotating it disconnects every user.
- Each preview domain needs its own `DRIVE_APP_ORIGIN` and Google redirect URI; previews can't share the production cookie.
- Turn on **Analytics** and **Speed Insights** in the Vercel dashboard. Neither needs a key; the app already mounts both, and they send no family tree data.

## Public pages and OAuth branding

`/privacy-policy` and `/terms-of-service` are standalone HTML pages that work without JavaScript. The build fills in the identity variables, so preview them through Vite rather than opening the files directly.

In **Google Auth Platform → Branding**, use `${PUBLIC_APP_URL}` as the homepage, `${PUBLIC_APP_URL}/privacy-policy` as the privacy policy, and `${PUBLIC_APP_URL}/terms-of-service` as the terms of service, and verify the domain. See [Google's branding guidance](https://support.google.com/cloud/answer/15549049?hl=en).

Forks must set all three `PUBLIC_*` identity variables; empty values fall back to the original project's. The identity variables don't change the policy's hosting and data-practice text, so edit the pages if your fork changes hosting, tracking, or storage.

## After deploying

- Open both legal pages and confirm they render with your identity.
- Connect Drive over HTTPS and save a tree. Reload, then fully restart the browser, and save again without being asked to sign in.
- Disconnect Drive and confirm local trees stay and the next Drive action asks for authorization.
- In developer tools, auth responses set HttpOnly, Secure, SameSite cookies and `Cache-Control: no-store`. Don't share token or cookie values in logs or screenshots.
