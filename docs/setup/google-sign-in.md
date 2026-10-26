# Turn on "Continue with Google"

Until these two keys are set, Jane signs people in by email only and the Google button is hidden
on /login and /signup. Google's OAuth client is free. About 10 minutes.

## 1. Make a Google OAuth client

1. Go to <https://console.cloud.google.com/> and sign in with the Google account that should own
   the app (a shared founders' account is best).
2. At the top, click the project picker, then **New project**. Name it "Jane" and create it.
3. Open **APIs & Services → OAuth consent screen** (it may be called **Google Auth Platform →
   Branding**).
   - User type: **External**.
   - App name: **Jane**. Support email and developer contact: your email.
   - Scopes: leave the defaults. Jane only needs your email, name and picture, and those need
     no review from Google.
   - Audience: while it says **Testing**, only the "Test users" you list can sign in. Add your
     beta testers' emails there, or click **Publish app** so anyone with an invite can sign in.
4. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**. Name: "Jane web".
   - **Authorized JavaScript origins**: your site's address, for example `https://your-domain`
     (the same address as `APP_URL`).
   - **Authorized redirect URIs**: `https://your-domain/api/auth/callback/google`
   - Click **Create**.
5. A box shows a **Client ID** (ends in `.apps.googleusercontent.com`) and a **Client secret**.
   Keep this tab open for the next step.

## 2. Add them to Vercel

In Vercel, open the Jane project, then **Settings → Environment Variables**. Add these two for
**Production**:

| Name | Value |
| --- | --- |
| `AUTH_GOOGLE_ID` | the Client ID |
| `AUTH_GOOGLE_SECRET` | the Client secret |

They take effect on the next deploy. Every merge to main deploys by itself, or you can click
**Redeploy** on the latest deployment.

## 3. Check it

- Open `/login` on the live site: **Continue with Google** is there, under the email box.
- Sign in with a Google account that has an invite (during the closed beta). New accounts still
  need an invite code: on /signup, enter the code first, then click Continue with Google.
- `/admin/launch` shows **Google sign-in** as done.

If Google shows "redirect_uri_mismatch", the redirect URI in step 4 doesn't match your site's
address exactly (check https and no trailing slash).

Never paste the client secret anywhere but Vercel's environment variables.
