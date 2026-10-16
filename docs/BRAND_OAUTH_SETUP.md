# Brand Account OAuth (Method 3)

Goal: Sync **scheduled/private** videos for The Ansible Playbook Brand Account from the Sheet menu.

## Step A — Standard Cloud project

1. Open your Apps Script project (from the Sheet: **Extensions → Apps Script**).
2. **Project Settings** (gear) → under **Google Cloud Platform (GCP) Project** click **Change project**.
3. Create a new Cloud project (or paste an existing project number).
4. In [Google Cloud Console](https://console.cloud.google.com/) for that project:
   - **APIs & Services → Library** → enable **YouTube Data API v3**.

## Step B — OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **Internal** (if redhat.com Workspace) or **External**.
3. App name e.g. `YouTube Demo BOM`.
4. Add scopes: `.../auth/youtube.readonly` (and whatever the wizard requires).
5. Save.

## Step C — OAuth client (Web application)

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Name e.g. `YouTube BOM Apps Script`.
4. **Authorized redirect URIs** — add exactly:

   ```
   https://script.google.com/macros/d/SCRIPT_ID/usercallback
   ```

   Replace `SCRIPT_ID` with your Apps Script ID from **Project Settings → Script ID**  
   (looks like `1aBzs6xtYOZ84P3u4ORtl8cDtUG1qJsdQalDLxLDzWoO0UC96VcjP-zda`).

5. Create → copy **Client ID** and **Client secret**.

## Step D — Script properties

In Apps Script → **Project Settings → Script properties** → add:

| Property | Value |
|----------|--------|
| `YOUTUBE_OAUTH_CLIENT_ID` | *(client id)* |
| `YOUTUBE_OAUTH_CLIENT_SECRET` | *(client secret)* |

## Step E — Code + OAuth2 library

1. Paste/update repo files including `BrandOAuth.js`, `YouTubeHttp.js`, `Menu.js`, `YouTube.js`, `appsscript.json`.
2. Confirm library **OAuth2** appears under **Libraries** (or add manually):
   - Script ID: `1B7FSrk5Zi6L1rSxxTDgDEUsPokyzqmevQ9RP8eGCMvndRAWP1xd9xgHC`
   - Identifier: `OAuth2`
   - Version: latest (repo pins `43`)

## Step F — Authorize brand + sync

1. Hard-refresh the Sheet.
2. **YouTube BOM → Authorize Brand YouTube Account** → open the link.
3. Sign in as redhat.com → **pick The Ansible Playbook** if shown → Allow.
4. **YouTube BOM → List Brand OAuth channels** — Playbook should appear.
5. **YouTube BOM → Sync YouTube** — expect `Auth path: brand-oauth` and `scheduled=…`.

## Reset

**YouTube BOM → Reset Brand YouTube auth**, then authorize again (e.g. if you picked the wrong account).
