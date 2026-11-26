"""Upload one approved Short with the toolkit's own tools/youtube_upload.py (private or scheduled, never public).

usage: yt_upload.py <toolkit> <video.mp4> <publish.json> <private|scheduled> <hour|none>
Prints "VIDEO_ID <id>" on success.
"""
import json
import os
import sys

toolkit, video, meta_path, mode, hour = sys.argv[1:6]
sys.path.insert(0, os.path.join(toolkit, "tools"))
os.chdir(toolkit)
import youtube_upload as YU  # noqa: E402

with open(meta_path, encoding="utf-8") as f:
    meta = json.load(f)
publish_hour = int(hour) if mode == "scheduled" and hour not in ("", "none") else None
vid = YU.upload(video, meta["title"], meta.get("description", ""), meta.get("tags", []), "private", publish_hour)
print("VIDEO_ID", vid, flush=True)
