"""Upload one approved Short as PRIVATE, optionally scheduled to go public at an exact time. Never public now.

Uses the toolkit's tools/youtube_upload.py for the sign-in (youtube_token.json in the toolkit).
usage: yt_upload.py <toolkit> <video.mp4> <publish.json> <private|scheduled> <publishAt ISO-8601 | none>
Prints "VIDEO_ID <id>" on success.
"""
import json
import os
import sys

toolkit, video, meta_path, mode, publish_at = sys.argv[1:6]
sys.path.insert(0, os.path.join(toolkit, "tools"))
os.chdir(toolkit)
import youtube_upload as YU  # noqa: E402
from googleapiclient.discovery import build  # noqa: E402
from googleapiclient.http import MediaFileUpload  # noqa: E402

with open(meta_path, encoding="utf-8") as f:
    meta = json.load(f)
title = meta["title"][:100]
description = meta.get("description", "")
if "#shorts" not in (title + description).lower():
    description = (description + "\n\n#Shorts").strip()
status = {"privacyStatus": "private", "selfDeclaredMadeForKids": False}
if mode == "scheduled" and publish_at not in ("", "none"):
    status["publishAt"] = publish_at  # stays private until then, then YouTube publishes it
body = {
    "snippet": {"title": title, "description": description[:4900], "tags": list(meta.get("tags", []))[:30], "categoryId": "24"},
    "status": status,
}
yt = build("youtube", "v3", credentials=YU._creds())
req = yt.videos().insert(part="snippet,status", body=body, media_body=MediaFileUpload(video, chunksize=-1, resumable=True))
resp = None
while resp is None:
    _, resp = req.next_chunk()
print("VIDEO_ID", resp["id"], flush=True)
