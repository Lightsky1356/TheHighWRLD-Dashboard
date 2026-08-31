import urllib.request
import ssl
import re

# Create SSL context that doesn't verify
ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE

# Fetch the good deployment's index.html
url = 'https://0f6c7133.thehighwrlddashboard.pages.dev/'
req = urllib.request.Request(url)
response = urllib.request.urlopen(req, context=ssl_context)
html_content = response.read().decode('utf-8')

# Extract script tags
scripts = re.findall(r'<script[^>]*src="([^"]*)"[^>]*>', html_content)

print('Good deployment (0f6c7133) script tags:')
for i, script in enumerate(scripts, 1):
    print(f'{i}. {script}')

print(f'\nTotal scripts: {len(scripts)}')

# Check for problematic scripts
problematic = []
for script in scripts:
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
else:
    print('\nNo potentially blocking scripts found')
