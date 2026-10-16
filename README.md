# YouTube → Google Sheets content BOM

Sync videos from a YouTube channel into a Google Sheet used as a **bill of materials / content tracker**. Humans edit the same sheet out-of-band (script links, review checkboxes, notes) without the automation wiping those fields.

Default channel handle: `ansibleautomation` ([The Ansible Playbook](https://www.youtube.com/@ansibleautomation)) — configurable in the sheet.

---

## Design: Pattern A (chosen)

| Tab | Role |
|-----|------|
| `_youtube_raw` | Machine dump. **Full replace** on every sync. |
| `BOM` | Human tracker. Sync **only appends** new Video ID rows. Auto stats are `XLOOKUP` formulas into `_youtube_raw`. |
| `_config` | Channel handle / ID. |

**Why not Pattern B (single-tab upsert)?** Full-replace of a raw tab cannot touch human cells. Upsert scripts are easier to get wrong (accidental clears, sorted ranges, deleted “blank ID” checklist rows). Pattern A keeps the blast radius obvious: only `_youtube_raw` is disposable.

Stable key = **YouTube video ID**. Never match on title alone.

Full column ownership: [docs/COLUMN_CONTRACT.md](docs/COLUMN_CONTRACT.md).

### Auto vs human (summary)

**Auto** (script / formulas): Video ID (append-only; hidden on BOM), Title, URL, Status, Published or scheduled at, Views, Likes, Comments, Duration, Feed synced at (same timestamp for the whole sync run).

**Human** (never cleared by sync): Demo slug, Script / runbook URL, Repo path, Owner, Review status, Reviewed by, Reviewed on, Priority, Notes.

Rows with a **blank Video ID** are checklist items — sync leaves them alone forever.

---

## Quick start

### 1. Create the Google Sheet

1. Create a new Google Sheet.
2. Optionally paste headers from `templates/` (`bom_headers.csv`, `youtube_raw_headers.csv`, `config_seed.csv`), or let the script create tabs via **Ensure sheet structure**.

### 2. Bind Apps Script

**Option A — clasp (recommended, versioned in git)**

```bash
npm install
cp .clasp.json.example .clasp.json   # set scriptId from Apps Script → Project Settings
npx clasp login                       # once; enable Apps Script API at script.google.com/home/usersettings
npm run push                          # uploads src/ → the bound Apps Script project
```

Day-to-day: edit files under `src/` in Cursor → `npm run push` → hard-refresh the Sheet.  
`npm run pull` downloads from Apps Script if you changed something in the web editor.  
`npm run open` opens the script in the browser.

Confirm **Services** still lists **YouTube Data API v3** after the first push.

**Option B — paste manually**

1. Sheet → **Extensions → Apps Script**.
2. Copy files from `src/` into the project (`Config.js`, `YouTube.js`, `SheetSync.js`, `Menu.js`, `DemoMatch.js`, `appsscript.json`).
3. Enable **YouTube Data API v3** under Services.
4. Save.

### 3. Enable the YouTube Data API (Cloud project)

1. From Apps Script: **Project Settings → Google Cloud Platform (GCP) Project**.
2. In that Cloud project, enable **YouTube Data API v3**.
3. First run will prompt OAuth for Sheets + YouTube readonly.

**Scheduled / private videos (Brand Accounts):** Being **Primary owner** in Studio is not enough for Apps Script. Apps Script OAuth has **no Brand Account picker**, so `mine=true` often returns only your personal channel (e.g. `@seancavanaugh3817`) while the brand uploads playlist stays **public-only**.

### Workaround A — paste scheduled IDs (Apps Script)

1. YouTube Studio → scheduled video → copy ID from the URL (`…/video/VIDEO_ID/edit`).
2. **YouTube BOM → Add scheduled video IDs…** (or paste into `_extra_video_ids`).
3. **Sync YouTube** — dialog shows `Extra IDs requested/resolved` and ideally `scheduled=…`.

### Workaround B — Python OAuth (pick the brand in the browser)

```bash
pip install -r scripts/requirements-sync.txt
# place Desktop OAuth client JSON at scripts/client_secret.json
python3 scripts/sync_youtube_brand.py --channel-id UCPJo5UY1KsP7J1BuHmiWNzQ
```

In the browser consent screen, choose **The Ansible Playbook** if listed as a Brand Account identity.

### 4. Configure the channel

Open the `_config` tab (created by **YouTube BOM → Ensure sheet structure**):

| key | value |
|-----|--------|
| `channel_handle` | `ansibleautomation` |
| `channel_id` | *(optional but recommended — from List my YouTube channels)* |
| `auth_mode` | `auto` |
| `include_scheduled` | `true` |

### 5. Run sync

Reload the Sheet. Use the menu:

**YouTube BOM → Sync YouTube**

What happens:

1. `_youtube_raw` is replaced with the latest API rows.
2. Any video ID not already on `BOM` is appended (Video ID + `XLOOKUP` formulas).
3. Human columns and blank-ID rows are untouched.
4. Existing BOM auto columns refresh because their formulas read the new raw data.

---

## Refresh UX

| Method | How |
|--------|-----|
| Manual | **YouTube BOM → Sync YouTube** |
| Hourly trigger | **YouTube BOM → Install hourly sync trigger** |
| Remove trigger | **YouTube BOM → Remove sync triggers** |

Triggers run as the user who installed them. Re-authorize if YouTube OAuth expires.

---

## How not to break human edits

1. **Do not edit `_youtube_raw` by hand** — it is wiped every sync.
2. **Do not put human notes in auto columns (B–J)** — prefer Demo slug / Notes / Script URL.
3. **Do not delete Video ID** on a row you still care about as a tracked video (formulas will go blank).
4. **Blank Video ID rows are safe** — use them for scripts/checklist items without a video yet.
5. **Never sort `_youtube_raw` expecting it to stick** — it is rebuilt each run. Sort `BOM` if you need a view.
6. **Do not run a different “clear sheet” sync script** against `BOM`.

---

## Optional: map videos → demo slugs

Related marketplace repo `aap-orchestrator-demos` stores `youtube_url` on demos in `_data/demos.yml`.

```bash
python3 scripts/suggest_demo_slugs.py \
  --demos-yml ../aap-orchestrator-demos/_data/demos.yml \
  --out /tmp/demomap.csv
```

1. Create a Sheet tab `DemoMap`.
2. Paste the CSV (`video_id`, `demo_slug`, `source_url`).
3. **YouTube BOM → Suggest demo slugs** — fills blank **Demo slug** cells only.

---

## Repo layout

```
src/                  Apps Script (clasp rootDir)
  appsscript.json
  Config.js
  YouTube.js
  SheetSync.js
  Menu.js
  DemoMatch.js
templates/            Header / seed CSVs
docs/COLUMN_CONTRACT.md
scripts/suggest_demo_slugs.py
.clasp.json.example
.env.example
```

---

## Out of scope

- Rewriting the demo website
- Replacing Google Analytics
- Auto-posting or editing YouTube videos

---

## Success checks

After sync:

- [ ] Views / status on existing videos update without wiping Review / Script / Notes.
- [ ] New uploads appear as new `BOM` rows.
- [ ] Human-only rows (no Video ID) are still present.
- [ ] A teammate can set up from this README alone.
