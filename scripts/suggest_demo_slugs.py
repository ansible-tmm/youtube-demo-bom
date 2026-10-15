#!/usr/bin/env python3
"""
Parse aap-orchestrator-demos/_data/demos.yml and emit DemoMap CSV rows.

Usage:
  python3 scripts/suggest_demo_slugs.py \\
    --demos-yml ../aap-orchestrator-demos/_data/demos.yml \\
    --out /tmp/demomap.csv

Paste the CSV into a Google Sheet tab named DemoMap, then use
YouTube BOM → Suggest demo slugs (fills blank Demo slug cells only).
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

VIDEO_ID_PATTERNS = [
    re.compile(r"[?&]v=([\w-]{11})"),
    re.compile(r"youtu\.be/([\w-]{11})"),
    re.compile(r"youtube\.com/embed/([\w-]{11})"),
    re.compile(r"youtube\.com/shorts/([\w-]{11})"),
]


def extract_video_id(url: str) -> str | None:
    text = (url or "").strip()
    if re.fullmatch(r"[\w-]{11}", text):
        return text
    for pat in VIDEO_ID_PATTERNS:
        m = pat.search(text)
        if m:
            return m.group(1)
    return None


def parse_demos_yml(path: Path) -> list[tuple[str, str, str]]:
    """Minimal YAML scrape: slug + youtube_url pairs (no PyYAML required)."""
    text = path.read_text(encoding="utf-8")
    rows: list[tuple[str, str, str]] = []
    current_slug: str | None = None

    for line in text.splitlines():
        m_slug = re.match(r"^- slug:\s*(.+?)\s*$", line)
        if m_slug:
            current_slug = m_slug.group(1).strip().strip("\"'")
            continue
        m_yt = re.match(r"^\s+youtube_url:\s*(.+?)\s*$", line)
        if m_yt and current_slug:
            url = m_yt.group(1).strip().strip("\"'")
            vid = extract_video_id(url)
            if vid:
                rows.append((vid, current_slug, url))

    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--demos-yml",
        type=Path,
        default=Path("../aap-orchestrator-demos/_data/demos.yml"),
        help="Path to demos.yml",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output CSV path (default: stdout)",
    )
    args = parser.parse_args()

    if not args.demos_yml.is_file():
        print(f"File not found: {args.demos_yml}", file=sys.stderr)
        return 1

    rows = parse_demos_yml(args.demos_yml)
    out_rows = [("video_id", "demo_slug", "source_url"), *rows]

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open("w", encoding="utf-8", newline="") as fh:
            csv.writer(fh).writerows(out_rows)
        print(f"Wrote {len(rows)} mapping(s) to {args.out}")
    else:
        writer = csv.writer(sys.stdout)
        writer.writerows(out_rows)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
