#!/usr/bin/env python3
"""Build and deploy Teletorch to Cloudflare Workers using the plain REST API.

No wrangler required -- uses multipart module upload directly.

Environment variables (never commit them):
  CF_API_TOKEN    -- Cloudflare API token with Workers:Edit permission
  CF_ACCOUNT_ID   -- Cloudflare account ID
  WORKER_NAME     -- optional, defaults to "teletorch"
  CUSTOM_HOSTNAME -- optional custom domain (e.g. teletorch.example.com)
  CF_ZONE_ID      -- required when CUSTOM_HOSTNAME is set

Usage:
  python scripts/deploy.py              # build + deploy
  python scripts/deploy.py --build-only # only generate src/page.mjs
"""

import json
import os
import pathlib
import sys
import urllib.request
import urllib.error
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
API = 'https://api.cloudflare.com/client/v4'
E = os.environ


# ---------------------------------------------------------------------------
# REST helper
# ---------------------------------------------------------------------------

def call(method, path, data=None, ctype='application/json'):
    """Make a Cloudflare API call. Returns parsed JSON response."""
    body = (
        data if isinstance(data, (bytes, type(None)))
        else json.dumps(data).encode()
    )
    req = urllib.request.Request(
        API + path,
        data=body,
        method=method,
        headers={
            'Authorization': 'Bearer ' + E['CF_API_TOKEN'],
            'Content-Type': ctype,
        },
    )
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as exc:
        return json.loads(exc.read() or b'{}')


# ---------------------------------------------------------------------------
# Build step: generate src/page.mjs from web/index.html
# ---------------------------------------------------------------------------

def build():
    """Embed web/index.html into src/page.mjs as an exported string."""
    html_path = ROOT / 'web' / 'index.html'
    if not html_path.exists():
        print('WARNING: web/index.html not found -- page.mjs will be a placeholder.')
        html = '<!DOCTYPE html><html><head><title>Teletorch</title></head><body></body></html>'
    else:
        html = html_path.read_text(encoding='utf-8')

    out = (
        '// Generated from web/index.html by scripts/deploy.py --build-only\n'
        '// Do not edit by hand.\n'
        'export const PAGE = ' + json.dumps(html) + ';\n'
    )
    page_mjs = ROOT / 'src' / 'page.mjs'
    page_mjs.write_text(out, encoding='utf-8')
    print(f'built {page_mjs.relative_to(ROOT)}  ({len(html)} bytes of HTML)')


# ---------------------------------------------------------------------------
# Deploy step
# ---------------------------------------------------------------------------

def main():
    build()

    acc  = E['CF_ACCOUNT_ID']
    name = E.get('WORKER_NAME', 'teletorch')

    # Only binding: Workers AI
    bindings = [
        {'type': 'ai', 'name': 'AI'},
    ]

    meta = {
        'main_module': 'worker.mjs',
        'compatibility_date': '2025-09-01',
        'bindings': bindings,
    }

    # Collect every *.mjs file in src/ -- upload all as ES modules
    src_dir = ROOT / 'src'
    mjs_files = sorted(src_dir.glob('*.mjs'))
    if not mjs_files:
        print('ERROR: no .mjs files found in src/', file=sys.stderr)
        sys.exit(1)

    print(f'Uploading {len(mjs_files)} module(s) as worker "{name}":')
    for f in mjs_files:
        print(f'  {f.name}')

    # Build multipart body
    boundary = '----teletorch' + uuid.uuid4().hex
    parts = [
        # Metadata part (no filename)
        ('metadata', None, 'application/json', json.dumps(meta).encode()),
    ]
    for f in mjs_files:
        parts.append((f.name, f.name, 'application/javascript+module', f.read_bytes()))

    body = b''
    for part_name, filename, content_type, data in parts:
        body += f'--{boundary}\r\n'.encode()
        disp = f'Content-Disposition: form-data; name="{part_name}"'
        if filename:
            disp += f'; filename="{filename}"'
        body += (disp + '\r\n').encode()
        body += f'Content-Type: {content_type}\r\n\r\n'.encode()
        body += data + b'\r\n'
    body += f'--{boundary}--\r\n'.encode()

    # Upload worker script
    r = call(
        'PUT',
        f'/accounts/{acc}/workers/scripts/{name}',
        body,
        f'multipart/form-data; boundary={boundary}',
    )
    ok = r.get('success', False)
    errors = [e.get('message', '') for e in r.get('errors', [])]
    print(f'upload ok={ok}', errors if errors else '')

    if not ok:
        print('Upload failed. Aborting.', file=sys.stderr)
        sys.exit(1)

    # Enable workers.dev subdomain
    r = call(
        'POST',
        f'/accounts/{acc}/workers/scripts/{name}/subdomain',
        {'enabled': True},
    )
    print(f'workers.dev ok={r.get("success")}')

    # Optional: attach custom domain via Workers Domains API
    host = E.get('CUSTOM_HOSTNAME')
    if host:
        zone_id = E.get('CF_ZONE_ID')
        if not zone_id:
            print('WARNING: CUSTOM_HOSTNAME set but CF_ZONE_ID missing -- skipping custom domain.')
        else:
            r = call(
                'PUT',
                f'/accounts/{acc}/workers/domains',
                {
                    'hostname':    host,
                    'service':     name,
                    'zone_id':     zone_id,
                    'environment': 'production',
                },
            )
            ok_domain = r.get('success', False)
            errs = [e.get('message', '') for e in r.get('errors', [])]
            print(f'custom domain {host} ok={ok_domain}', errs if errs else '')

    print('Done.')


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    if '--build-only' in sys.argv:
        build()
    else:
        # Require credentials before attempting anything
        missing = [v for v in ('CF_API_TOKEN', 'CF_ACCOUNT_ID') if not E.get(v)]
        if missing:
            print(
                f'ERROR: missing environment variables: {", ".join(missing)}',
                file=sys.stderr,
            )
            sys.exit(1)
        main()
