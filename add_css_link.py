import re

# Read the restored index.html
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Add the community-realtime.css link before the closing head tag
if 'community-realtime.css' not in content:
    content = content.replace('</head>', '<link rel="stylesheet" href="./community-realtime.css"></head>')

# Write back
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Added community-realtime.css link')
