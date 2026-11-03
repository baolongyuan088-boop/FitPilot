#!/usr/bin/env python3
"""Keep a local beta entry URL out of the shared source repository."""
import argparse
import os
from pathlib import Path
import plistlib
from urllib.parse import urlsplit

parser = argparse.ArgumentParser()
parser.add_argument("--url", default=os.environ.get("BETA_APP_URL"))
args = parser.parse_args()
app = Path(__file__).resolve().parents[1] / "App"
config = plistlib.loads((app / "AppConfiguration.example.plist").read_bytes())
if args.url:
    url = urlsplit(args.url.strip())
    if (url.scheme != "https" or not url.hostname
        or not (url.hostname == config["AllowedHost"] or url.hostname.endswith(".baolongyuan.site"))
        or url.username or url.password or url.port not in (None, 443)):
        parser.error("Use this app's HTTPS endpoint or a baolongyuan.site subdomain")
    config["DefaultURL"] = args.url.strip()
target = app / "AppConfiguration.plist"
target.write_bytes(plistlib.dumps(config))
target.chmod(0o600)
print("Local app endpoint configured; URL not printed.")
