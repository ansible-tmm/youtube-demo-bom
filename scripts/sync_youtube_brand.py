#!/usr/bin/env python3
"""
Optional Brand Account sync (when Apps Script cannot see scheduled videos).

Apps Script OAuth has no "switch to Brand Account" step, so Primary owners often
only get their personal channel via mine=true and a public uploads playlist for
the brand. This script uses an installed-app OAuth flow where Google’s browser
chooser CAN include Brand Accounts — pick "The Ansible Playbook" there.

Setup (once):
  1. Google Cloud Console → create/select a project
  2. Enable YouTube Data API v3
  3. OAuth consent screen (Internal if Workspace)
  4. Credentials → OAuth client ID → Desktop app → download JSON as
     client_secret.json in this directory (gitignored)
  5. pip install -r scripts/requirements-sync.txt

Run:
  python3 scripts/sync_youtube_brand.py \\
    --channel-id UCPJo5UY1KsP7J1BuHmiWNzQ \\
    --out /tmp/youtube_raw.csv

During the browser login, choose **The Ansible Playbook** brand identity
(not only your personal Sean channel). Then import the CSV into _youtube_raw
or use --sheets-id with a service account / user Sheets scope (optional later).

This script prints status counts so you can confirm scheduled > 0.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"]
TOKEN_PATH = Path(__file__).resolve().parent / "token.json"
CLIENT_SECRET = Path(__file__).resolve().parent / "client_secret.json"


def iso_duration_to_human(iso: str) -> str:
    m = re.match(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$", iso or "")
    if not m:
        return iso or ""
    h, mi, s = (int(m.group(i) or 0) for i in (1, 2, 3))
    parts = []
    if h:
        parts.append(f"{h}h")
    if mi or h:
        parts.append(f"{mi}m")
    parts.append(f"{s}s")
    return " ".join(parts)


def normalize_video(item: dict, synced_at: str) -> list:
    status = item.get("status") or {}
    snippet = item.get("snippet") or {}
    stats = item.get("statistics") or {}
    content = item.get("contentDetails") or {}
    privacy = status.get("privacyStatus") or ""
    publish_at = status.get("publishAt") or ""
    published_at = snippet.get("publishedAt") or ""
    scheduled = bool(publish_at) and privacy != "public"
    if scheduled:
        label = "scheduled"
    elif privacy == "public":
        label = "published"
    else:
        label = privacy or "unknown"
    when = publish_at if scheduled else published_at
    return [
        item["id"],
        snippet.get("title") or "",
        f"https://www.youtube.com/watch?v={item['id']}",
        label,
        when,
        stats.get("viewCount", ""),
        stats.get("likeCount", ""),
        stats.get("commentCount", ""),
        iso_duration_to_human(content.get("duration") or ""),
        privacy,
        synced_at,
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--channel-id",
        default="UCPJo5UY1KsP7J1BuHmiWNzQ",
        help="YouTube channel ID",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("/tmp/youtube_raw.csv"),
        help="CSV output path",
    )
    parser.add_argument(
        "--client-secret",
        type=Path,
        default=CLIENT_SECRET,
        help="OAuth desktop client secret JSON",
    )
    args = parser.parse_args()

    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
    except ImportError:
        print(
            "Missing deps. Run: pip install -r scripts/requirements-sync.txt",
            file=sys.stderr,
        )
        return 1

    if not args.client_secret.is_file():
        print(f"Missing {args.client_secret}", file=sys.stderr)
        print("Download a Desktop OAuth client JSON from Google Cloud Console.", file=sys.stderr)
        return 1

    creds = None
    if TOKEN_PATH.is_file():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                str(args.client_secret), SCOPES
            )
            print(
                "\n*** In the browser, pick Brand Account "
                "'The Ansible Playbook' if shown ***\n"
            )
            creds = flow.run_local_server(port=0)
        TOKEN_PATH.write_text(creds.to_json(), encoding="utf-8")

    youtube = build("youtube", "v3", credentials=creds)

    # Show which channels this token can see as mine
    mine = (
        youtube.channels()
        .list(part="snippet,contentDetails", mine=True, maxResults=50)
        .execute()
    )
    print("Channels visible to this token (mine=true):")
    for ch in mine.get("items") or []:
        sn = ch.get("snippet") or {}
        print(f"  - {sn.get('title')} | @{sn.get('customUrl')} | {ch['id']}")

    ch_resp = (
        youtube.channels()
        .list(part="snippet,contentDetails", id=args.channel_id)
        .execute()
    )
    if not ch_resp.get("items"):
        print(f"Channel not found: {args.channel_id}", file=sys.stderr)
        return 1
    channel = ch_resp["items"][0]
    uploads = channel["contentDetails"]["relatedPlaylists"]["uploads"]
    title = channel["snippet"]["title"]

    video_ids: list[str] = []
    page_token = None
    while True:
        req = youtube.playlistItems().list(
            part="contentDetails",
            playlistId=uploads,
            maxResults=50,
            pageToken=page_token,
        )
        page = req.execute()
        for it in page.get("items") or []:
            vid = (it.get("contentDetails") or {}).get("videoId")
            if vid:
                video_ids.append(vid)
        page_token = page.get("nextPageToken")
        if not page_token:
            break

    synced_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    rows: list[list] = []
    for i in range(0, len(video_ids), 50):
        batch = video_ids[i : i + 50]
        resp = (
            youtube.videos()
            .list(
                part="snippet,status,contentDetails,statistics",
                id=",".join(batch),
            )
            .execute()
        )
        for item in resp.get("items") or []:
            rows.append(normalize_video(item, synced_at))

    counts: dict[str, int] = {}
    for row in rows:
        counts[row[3]] = counts.get(row[3], 0) + 1

    headers = [
        "Video ID",
        "Title",
        "URL",
        "Status",
        "Published or scheduled at",
        "Views",
        "Likes",
        "Comments",
        "Duration",
        "Privacy",
        "Feed synced at",
    ]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(headers)
        w.writerows(rows)

    print(f'\nSynced {len(rows)} videos from "{title}"')
    print("Statuses:", ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    print(f"Wrote {args.out}")
    if counts.get("scheduled", 0) == 0 and counts.get("private", 0) == 0:
        print(
            "\nNo scheduled/private rows. Delete scripts/token.json and re-run,\n"
            "selecting The Ansible Playbook brand in the browser chooser.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
