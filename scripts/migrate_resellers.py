import json
from pathlib import Path
path = Path('/home/ubuntu/zeeor-fashion-store/data/store.json')
data = json.loads(path.read_text())
resellers = data.get('resellers', [])
preferred = next((r for r in resellers if r.get('username') == 'zeeor-partner'), None)
if preferred is None:
    preferred = next((r for r in resellers if r.get('username') == 'zeeor-reseller-01'), None)
if preferred is None:
    preferred = {'id': 'r-zeeor-partner', 'username': 'zeeor-partner', 'displayName': 'ZEEOR Partner', 'passwordHash': '', 'listings': [], 'createdAt': '2026-01-01T00:00:00.000Z'}
preferred['id'] = 'r-zeeor-partner'
preferred['username'] = 'zeeor-partner'
preferred['displayName'] = 'ZEEOR Partner'
preferred['active'] = True
preferred.setdefault('listings', [])
for listing in preferred['listings']:
    listing.setdefault('active', True)
data['resellers'] = [preferred]
path.write_text(json.dumps(data, indent=2) + '\n')
