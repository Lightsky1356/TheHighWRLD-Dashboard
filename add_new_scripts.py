import re

# Read the restored index.html
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the last script tag and add the new ones after it
# Look for existing script tags
scripts = re.findall(r'<script[^>]*src="([^"]*)"[^>]*></script>', content)
print('Existing scripts:', scripts)

# Add the new scripts if they're not already there
new_scripts = ['./presence.js', './wanted-realtime.js', './community-realtime.js', './pwa.js']
for script in new_scripts:
    if script not in scripts:
        print(f'Adding {script}')
        # Add before the closing head tag
        content = content.replace('</head>', f'<script src="{script}"></script></head>')

# Write back
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done')
