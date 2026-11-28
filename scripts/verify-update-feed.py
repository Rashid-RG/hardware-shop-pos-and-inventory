#!/usr/bin/env python3
"""Independently verify a prepared update feed using only the public trust key."""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--feed",type=Path,required=True)
    parser.add_argument("--version",required=True)
    parser.add_argument("--public-key",type=Path,required=True)
    args=parser.parse_args()
    if not re.fullmatch(r"(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})",args.version):
        parser.error("Stable version required.")
    try:
        if args.feed.is_symlink() or {p.name for p in args.feed.iterdir()}!={"windows","linux-mint","release-record.json"}:
            raise ValueError("Unexpected release directory inventory.")
        record=args.feed/"release-record.json"
        if record.is_symlink() or not record.is_file() or record.stat().st_size>4096:
            raise ValueError("Invalid local release record.")
        data=json.loads(record.read_bytes())
        if data.get("version")!=args.version or not isinstance(data.get("commit"),str) or not re.fullmatch(r"[a-f0-9]{40}",data["commit"]) or data.get("published") is not False or data.get("liveUpdatesApproved") is not False:
            raise ValueError("Invalid non-authorizing release record.")
        spec=importlib.util.spec_from_file_location("feed",Path(__file__).with_name("prepare-update-feed.py"))
        feed=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(feed)
        feed.verify_feed(args.feed,args.version,args.public_key,commit=data["commit"])
    except (OSError,ValueError,TypeError,AttributeError,subprocess.SubprocessError) as error:
        sys.exit("Feed verification failed: "+str(error))
    print(json.dumps({"version":args.version,"platforms":["windows","linux-mint"],"signaturesVerified":True,"publicationAuthorized":False,"liveUpdatesApproved":False}))

if __name__=="__main__":
    main()
