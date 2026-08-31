import re

# Read local index.html
with open('index.html', 'r', encoding='utf-8') as f:
    local_html = f.read()

# Extract script tags from local
local_scripts = re.findall(r'<script[^>]*src="([^"]*)"[^>]*>', local_html)
print('Local deployment script tags:')
for i, script in enumerate(local_scripts, 1):
    print(f'{i}. {script}')

print(f'\nTotal scripts: {len(local_scripts)}')

# Check for problematic scripts
problematic = []
for script in local_scripts:
    if 'presence.js' in script:
        problematic.append(('presence.js', 'Online Status WebSocket'))
    if 'wanted-realtime.js' in script:
        problematic.append(('wanted-realtime.js', 'Wanted Vault polling'))
    if 'community-realtime.js' in script:
        problematic.append(('community-realtime.js', 'Community realtime'))
    if 'pwa.js' in script:
        problematic.append(('pwa.js', 'PWA initialization'))

if problematic:
    print('\nPotentially blocking scripts:')
    for script, reason in problematic:
        print(f'- {script}: {reason}')
