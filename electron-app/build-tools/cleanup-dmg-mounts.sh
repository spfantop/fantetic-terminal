#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
import plistlib
import re
import subprocess

info = plistlib.loads(subprocess.check_output(['hdiutil', 'info', '-plist']))
for image in info.get('images', []):
    for entity in image.get('system-entities', []):
        mount_point = entity.get('mount-point', '')
        device = entity.get('dev-entry', '')
        if not mount_point.startswith('/Volumes/Fantetic Terminal') or not device:
            continue
        disk = re.sub(r's\d+$', '', device)
        print(f'[dmg-recovery] Detaching stale image {disk} mounted at {mount_point}')
        subprocess.run(['hdiutil', 'detach', '-force', disk], check=False)
PY
