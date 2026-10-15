# Column contract

Stable key: **YouTube video ID** (never title alone).

This project uses **Pattern A**:

| Tab | Owner | Sync behavior |
|-----|--------|----------------|
| `_youtube_raw` | Machine | **Full replace** every sync |
| `BOM` | Humans + append-only automation | Sync **appends** new video IDs only; never clears human cells |
| `_config` | Humans | Channel handle / ID settings |
| `DemoMap` (optional) | Humans / offline script | Lookup table for demo slug suggestions |

---

## `_youtube_raw` (machine-owned)

| Column | Field | Notes |
|--------|--------|--------|
| A | Video ID | Primary key |
| B | Title | From API |
| C | URL | `https://www.youtube.com/watch?v={id}` |
| D | Status | `published` / `scheduled` / `private` / `unlisted` |
| E | Published or scheduled at | `snippet.publishedAt` or `status.publishAt` |
| F | Views | May be blank for private/scheduled |
| G | Likes | |
| H | Comments | |
| I | Duration | Clock form (`M:SS` or `H:MM:SS`) |
| J | Privacy | Raw `privacyStatus` |
| K | Last synced at | Timestamp of this sync run |

Do not edit this tab by hand. Treat it as a disposable API dump.

---

## `BOM` (human tracker)

### Auto (formula / machine)

Written **only when a new Video ID row is appended**. After that, values refresh via `XLOOKUP` into `_youtube_raw` when sync replaces the raw tab. The sync job never overwrites these cells on existing rows.

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
| J | Last synced at |

### Human (never auto-cleared)

Sync **never** writes these columns. Optional “Suggest demo slugs” may fill **Demo slug** only where it is blank.

| Column | Field | Suggested values |
|--------|--------|------------------|
| K | Demo slug | e.g. `cve-remediation` |
| L | Script / runbook URL | Docs, Google Doc, etc. |
| M | Repo path | Path in related git repo |
| N | Owner | |
| O | Review status | `Not started` / `In review` / `Approved` |
| P | Reviewed by | |
| Q | Reviewed on | |
| R | Priority | |
| S | Notes | |

### Human-only rows

Rows with a **blank Video ID** are checklist / script / planning items. Sync ignores them forever (no delete, no overwrite).

---

## `_config`

| key | value example | Notes |
|-----|----------------|--------|
| `channel_handle` | `ansibleautomation` | No leading `@` |
| `channel_id` | `UCxxxxx` | Optional; wins over handle if set |
| `include_scheduled` | `true` | Reserved; visibility still depends on OAuth identity |

---

## What sync is allowed to do

| Action | Allowed? |
|--------|----------|
| Replace all `_youtube_raw` data rows | Yes |
| Append new `BOM` rows for unseen video IDs | Yes |
| Update views/status on existing BOM via formulas + raw refresh | Yes (indirect) |
| Clear or edit Demo slug / Script URL / Review / Notes | **No** |
| Delete BOM rows (including blank-ID rows) | **No** |
| Match titles to demos without video ID | **No** |
