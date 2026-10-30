#!/usr/bin/env python3
"""Export Chrome's cookies for one site as an agent-browser cookie file.

Usage: browser-cookies.py URL OUTFILE
  e.g. browser-cookies.py https://www.instacart.com "$TMPDIR/instacart-cookies.json"

Writes a JSON array (mode 0600) for `agent-browser cookies set --curl OUTFILE`
and prints only the cookie count. Values come from `pycookiecheat`, which
decrypts Chrome's store; domain, path and flags come from Chrome's database,
because agent-browser rejects `__Host-` cookies that carry a domain.
"""
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from urllib.parse import urlparse

if len(sys.argv) != 3:
    sys.exit(__doc__.strip().splitlines()[2])
url, outfile = sys.argv[1], sys.argv[2]
host = urlparse(url).hostname or sys.exit("URL must include a host, e.g. https://www.instacart.com")
site = ".".join(host.split(".")[-2:])

values = json.loads(subprocess.run(["pycookiecheat", url], check=True, capture_output=True, text=True).stdout)

candidates = [
    os.environ.get("CHROME_COOKIE_DB", ""),
    os.path.expanduser("~/.config/google-chrome/Default/Cookies"),
    os.path.expanduser("~/.config/google-chrome/Default/Network/Cookies"),
    os.path.expanduser("~/Library/Application Support/Google/Chrome/Default/Cookies"),
]
database = next((path for path in candidates if path and os.path.exists(path)), None) or sys.exit("Chrome cookie database not found; set CHROME_COOKIE_DB.")
# Chrome holds the database open; read a copy.
with tempfile.TemporaryDirectory() as scratch:
    copy = os.path.join(scratch, "Cookies")
    shutil.copy(database, copy)
    rows = sqlite3.connect(copy).execute(
        "SELECT host_key, name, path, is_secure, is_httponly FROM cookies WHERE host_key = ? OR host_key LIKE ?",
        (site, f"%.{site}"),
    ).fetchall()

cookies = []
for host_key, name, path, secure, httponly in rows:
    if name not in values:
        continue
    cookie = {"name": name, "value": values[name], "path": path, "secure": bool(secure), "httpOnly": bool(httponly)}
    if name.startswith("__Host-") or not host_key.startswith("."):
        cookie["url"] = f"https://{host_key.lstrip('.')}{path}"
    else:
        cookie["domain"] = host_key
    cookies.append(cookie)

descriptor = os.open(outfile, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(descriptor, "w") as handle:
    json.dump(cookies, handle)
print(f"{len(cookies)} cookies for {site} written to {outfile}")
