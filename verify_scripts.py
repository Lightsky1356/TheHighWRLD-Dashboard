import re

# Read index.html
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Extract script tags
scripts = re.findall(r'<script[^>]*src="([^"]*)"[^>]*></script>', content)

print('Current script tags:')
for i, script in enumerate(scripts, 1):
    print(f'{i}. {script}')

print(f'\nTotal scripts: {len(scripts)}')

# Check for required scripts
required = ['./presence.js', './wanted-realtime.js', './community-realtime.js', './pwa.js']
missing = [s for s in required if s not in scripts]

if missing:
    print(f'\nMissing scripts: {missing}')
else:
    print('\nAll required scripts present')
