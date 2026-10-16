#!/usr/bin/env python3
"""
One-time: OAuth as the YouTube Brand Account and print a refresh token.

Apps Script cannot complete Brand Account login via /usercallback (you hit
"Authorization is required to perform that action"). This script does the
browser login instead; you paste the refresh token into Apps Script.

Setup:
  1. Cloud project ansible-youtube-bom (same as the Sheet)
  2. OAuth consent: External + Testing, add yourself as test user
  3. Credentials → Create OAuth client → Application type: Desktop app
  4. Download JSON → save as scripts/client_secret.json (gitignored)
  5. pip install -r scripts/requirements-sync.txt

Run:
  python3 scripts/get_brand_refresh_token.py

In the browser, pick the Brand Account that owns The Ansible Playbook
(try each Youtube brand until List/mine shows UCPJo5UY1KsP7J1BuHmiWNzQ).

Then in Apps Script → Project Settings → Script properties, set:
  YOUTUBE_OAUTH_CLIENT_ID       = (Desktop client id)
  YOUTUBE_OAUTH_CLIENT_SECRET   = (Desktop client secret)
  YOUTUBE_BRAND_REFRESH_TOKEN   = (printed refresh_token)

Sheet → Sync YouTube should then use Auth path: brand-refresh-token.
"""

from __future__ import annotations

import sys
from pathlib import Path

SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"]
CLIENT_SECRET = Path(__file__).resolve().parent / "client_secret.json"
TOKEN_PATH = Path(__file__).resolve().parent / "token.json"


def main() -> int:
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
    except ImportError:
        print(
            "ERROR: Google API packages not installed.\n"
            "Run this first:\n"
            "  pip3 install -r scripts/requirements-sync.txt\n",
            file=sys.stderr,
        )
        return 1

    if not CLIENT_SECRET.is_file():
        print(
            f"ERROR: Missing OAuth client file:\n  {CLIENT_SECRET}\n\n"
            "In Google Cloud Console (project ansible-youtube-bom):\n"
            "  APIs & Services → Credentials → Create credentials\n"
            "  → OAuth client ID → Application type: Desktop app → Create\n"
            "  → Download JSON → save it as scripts/client_secret.json\n",
            file=sys.stderr,
        )
        return 1

    # Always re-consent so you can pick the brand and get a refresh token.
    if TOKEN_PATH.is_file():
        TOKEN_PATH.unlink()

    flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET), SCOPES)
    print(
        "\n*** Browser will open. Pick the Brand Account for "
        "The Ansible Playbook (not only Sean Cavanaugh). ***\n"
    )
    creds = flow.run_local_server(port=0, prompt="consent")

    if not creds.refresh_token:
        print(
            "No refresh_token returned. Delete token.json, revoke app access "
            "at https://myaccount.google.com/permissions, and re-run.",
            file=sys.stderr,
        )
        return 1

    TOKEN_PATH.write_text(creds.to_json(), encoding="utf-8")

    youtube = build("youtube", "v3", credentials=creds)
    mine = (
        youtube.channels()
        .list(part="snippet", mine=True, maxResults=50)
        .execute()
    )
    print("\nChannels visible to this token (mine=true):")
    playbook = False
    for ch in mine.get("items") or []:
        sn = ch.get("snippet") or {}
        line = f"  - {sn.get('title')} | @{sn.get('customUrl')} | {ch['id']}"
        print(line)
        if ch["id"] == "UCPJo5UY1KsP7J1BuHmiWNzQ":
            playbook = True

    print("\n========== PASTE INTO APPS SCRIPT ==========")
    print("Property: YOUTUBE_BRAND_REFRESH_TOKEN")
    print(creds.refresh_token)
    print("============================================\n")

    if not playbook:
        print(
            "WARNING: Playbook channel ID not in mine=true.\n"
            "Reset and pick a different Brand Account on the chooser.",
            file=sys.stderr,
        )
        return 2

    print("Playbook channel found. Script properties + Sync YouTube next.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
