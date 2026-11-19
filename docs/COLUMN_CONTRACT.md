# Column contract

Stable key: **YouTube video ID** (never title alone).

This project uses **Pattern A**:

| Tab | Owner | Sync behavior |
|-----|--------|----------------|
| `_youtube_raw` | Machine | **Full replace** every sync (newest date first) |
| `Scheduled` | Machine | **Full replace** — scheduled only, newest first |
| `Unlisted` | Machine | **Full replace** — unlisted only, newest first |
| `Private` | Machine | **Full replace** — private only, newest first |
| `BOM` | Humans + append-only automation | Sync **appends published** video IDs only; prunes empty non-published rows; sorts newest-first; never clears human cells |
| `_config` | Humans | Channel handle / ID settings |
| `DemoMap` (optional) | Humans / offline script | Lookup table for demo slug suggestions |

---

## `_youtube_raw` (machine-owned)

| Column | Field | Notes |
|--------|--------|--------|
| A | Video ID | Primary key |
| B | Title | From API |
| C | URL | `/watch?v=` or `/shorts/` when Format is `short` |
| D | Status | `published` / `scheduled` / `private` / `unlisted` |
| E | Published or scheduled at | `snippet.publishedAt` or `status.publishAt` |
| F | Views | May be blank for private/scheduled |
| G | Likes | |
| H | Comments | |
| I | Duration | Human form (`5m 32s`) |
| J | Format | `short` or `regular` (≤60s or `#shorts` → short) |
| K | Privacy | Raw `privacyStatus` |
| L | Subscribers gained | YouTube Analytics lifetime (needs `yt-analytics.readonly`) |
| M | Feed synced at | Same timestamp on every row for this sync run |

Do not edit this tab by hand. Treat it as a disposable API dump.

---

## `BOM` (human tracker)

BOM is the **published** catalog. Unlisted / private / scheduled live on their status tabs.

### Auto (formula / machine)

Written **only when a new published Video ID row is appended** (or repaired). Values refresh via `XLOOKUP` into `_youtube_raw`.

| Column | Field |
|--------|--------|
| A | Video ID *(key — append-only; humans may leave blank for checklist rows)* |
| B | Title |
| C | URL |
| D | Status |
| E | Published or scheduled at |
| F | Views |
| G | Likes |
| H | Comments |
| I | Duration |
| J | Format |
| K | Subscribers gained |
| L | Feed synced at |

### Human (never auto-cleared)

| Column | Field | Suggested values |
|--------|--------|------------------|
| M | Demo slug | e.g. `cve-remediation` |
| N | Script / runbook URL | Docs, Google Doc, etc. |
| O | Repo path | Path in related git repo |
| P | Owner | |
| Q | Review status | `Not started` / `In review` / `Approved` |
| R | Reviewed by | |
| S | Reviewed on | |
| T | Priority | |
| U | Notes | |

### Human-only rows

Rows with a **blank Video ID** are checklist / script / planning items. Sync ignores them forever (no delete, no overwrite).

Non-published Video ID rows with **empty** human columns are pruned on sync. Rows with human notes are kept.

---

## `_config`

| key | value example | Notes |
|-----|----------------|--------|
| `channel_handle` | `ansibleautomation` | No leading `@` |
| `channel_id` | `UCxxxxx` | Optional; use the ID from **List my YouTube channels** for reliable matches |
| `auth_mode` | `auto` | `auto` prefers managed (`mine`) match; `mine` forces it; `public` = handle lookup only |
| `include_scheduled` | `true` | Scheduled/private only appear when auth path is managed (`mine`) |

---

## What sync is allowed to do

| Action | Allowed? |
|--------|----------|
| Replace all `_youtube_raw` data rows | Yes |
| Append new `BOM` rows for unseen **published** video IDs | Yes |
| Prune non-published BOM rows with empty human columns | Yes |
| Sort BOM newest-first (whole rows) | Yes |
| Update views/status on existing BOM via formulas + raw refresh | Yes (indirect) |
| Clear or edit Demo slug / Script URL / Review / Notes | **No** |
| Delete BOM rows with human notes | **No** |
| Match titles to demos without video ID | **No** |
