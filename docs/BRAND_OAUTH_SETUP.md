# Brand Account auth (scheduled videos)

## Why the Sheet “Authorize Brand” flow fails

When you pick a **Brand Account** in Google’s chooser, the redirect hits Apps
Script `/usercallback` and shows:

> Authorization is required to perform that action.

Brand identities cannot run Apps Script callbacks. That path is a dead end for
Playbook scheduled videos.

## Working approach (refresh token)

Do Brand login **once in Python**, paste the refresh token into Apps Script,
then **Sync YouTube** in the Sheet as usual.

### 1. Desktop OAuth client

In Cloud project **ansible-youtube-bom**:

1. OAuth consent screen = **External** + **Testing**
2. Test users: your `scavanau@redhat.com`
3. **Credentials → Create credentials → OAuth client ID → Desktop app**
4. Download JSON → save as `scripts/client_secret.json` (gitignored)

### 2. Get the refresh token

```bash
cd /path/to/youtube-demo-bom
pip install -r scripts/requirements-sync.txt
python3 scripts/get_brand_refresh_token.py
```

In the browser, pick the Brand Account that owns **The Ansible Playbook**.
The script prints channels for `mine=true` — you want
`UCPJo5UY1KsP7J1BuHmiWNzQ`. If missing, re-run and pick a different brand.

### 3. Script properties

Apps Script → **Project Settings → Script properties**:

| Property | Value |
|----------|--------|
| `YOUTUBE_OAUTH_CLIENT_ID` | Desktop client ID |
| `YOUTUBE_OAUTH_CLIENT_SECRET` | Desktop client secret |
| `YOUTUBE_BRAND_REFRESH_TOKEN` | Printed refresh token |

(Replace earlier Web-client values with the **Desktop** client id/secret.)

### 4. Paste code + Sync

Ensure `BrandToken.js` is in the Apps Script project (from this repo).

Sheet → **List Brand OAuth channels** → should list Playbook.  
Then **Sync YouTube** → expect `Auth path: brand-refresh-token` and `scheduled=…`.

### Rotate / redo

Revoke the app under [Google Account permissions](https://myaccount.google.com/permissions),
delete `scripts/token.json`, re-run `get_brand_refresh_token.py`, update the
Script property.
