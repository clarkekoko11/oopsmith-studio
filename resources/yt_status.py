"""Print the privacy status of one of your YouTube videos: PRIVACY <public|private|unlisted>.
usage: yt_status.py <toolkit> <videoId>"""
import os
import sys

toolkit, vid = sys.argv[1:3]
sys.path.insert(0, os.path.join(toolkit, "tools"))
os.chdir(toolkit)
import youtube_upload as YU  # noqa: E402
from googleapiclient.discovery import build  # noqa: E402

yt = build("youtube", "v3", credentials=YU._creds())
items = yt.videos().list(part="status", id=vid).execute().get("items", [])
print("PRIVACY", items[0]["status"]["privacyStatus"] if items else "missing", flush=True)
