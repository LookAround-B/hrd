#!/usr/bin/env python3
"""Apply only the reviewed EFM source bundle, refusing concurrent changes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--apply', action='store_true', help='Write source files; default checks only')
args = parser.parse_args()
bundle = Path(__file__).resolve().parents[1] / 'integrations/efm-key-support'
target = Path('/home/samer/lookaround/Stable')
manifest = json.loads((bundle / 'manifest.json').read_text())
pending = []
for row in manifest:
    rel = Path(row['path'])
    if rel.is_absolute() or '..' in rel.parts or rel.parts[0] != 'backend':
        raise SystemExit('Invalid bundle path')
    source = (bundle / rel).read_bytes()
    if hashlib.sha256(source).hexdigest() != row['after']:
        raise SystemExit(f'Bundle content changed: {rel}')
    destination = target / rel
    if not destination.resolve().is_relative_to(target.resolve()):
        raise SystemExit(f'Target escapes EFM directory: {rel}')
    current = hashlib.sha256(destination.read_bytes()).hexdigest() if destination.exists() else None
    if current == row['after']:
        continue
    if current != row['before']:
        raise SystemExit(f'EFM changed since review; refusing to overwrite {rel}')
    pending.append((destination, source))
if args.apply:
    for destination, source in pending:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as stream:
            stream.write(source)
            temporary = stream.name
        os.chmod(temporary, destination.stat().st_mode & 0o777 if destination.exists() else 0o644)
        os.replace(temporary, destination)
    print(f'Applied {len(pending)} EFM source files. No database changes, key creation or deployment performed.')
else:
    print(f'{len(pending)} reviewed EFM source files can be applied; current source matches the review baseline.')
