#!/bin/bash
# Waypoint deploy script — busts asset cache on every deploy
set -e
cd /home/eduardo/waypoint

echo "=== Waypoint Deploy ==="

# 1. Remove old hashed files
rm -f static/css/*.*.css static/js/*.*.js

# 2. Hash and rename all assets, update index.html references
python3 << 'PYEOF'
import hashlib, shutil, os

base = '/home/eduardo/waypoint/static'
index_path = f'{base}/index.html'

# Read original index (with plain filenames)
with open(index_path) as f:
    html = f.read()

files = {
    '/css/app.css': f'{base}/css/app.css',
    **{f'/js/{f}': f'{base}/js/{f}'
       for f in ['app.js','profile.js','inbox.js','ui.js','pdf.js',
                 'timeline.js','dialog.js','segments.js','trips.js','connections.js']}
}

for url, path in files.items():
    if not os.path.exists(path):
        print(f'SKIP (not found): {path}')
        continue
    content = open(path, 'rb').read()
    h = hashlib.md5(content).hexdigest()[:8]
    ext = os.path.splitext(url)[1]
    base_name = os.path.splitext(os.path.basename(url))[0]
    new_name = f'{base_name}.{h}{ext}'
    new_path = os.path.join(os.path.dirname(path), new_name)
    shutil.copy2(path, new_path)
    old_ref = f'"{url}"'
    new_url = url.replace(os.path.basename(url), new_name)
    html = html.replace(old_ref, f'"{new_url}"', 1)
    print(f'  {os.path.basename(url)} → {new_name}')

with open(index_path, 'w') as f:
    f.write(html)
print('index.html updated')
PYEOF

# 3. Restart service
sudo systemctl restart waypoint
sleep 2
echo "=== Done ==="
sudo systemctl status waypoint --no-pager | tail -2
