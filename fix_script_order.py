import re

# Read index.html
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove the new scripts from their current position
content = re.sub(r'<script src="./presence\.js"></script>', '', content)
content = re.sub(r'<script src="./wanted-realtime\.js"></script>', '', content)
content = re.sub(r'<script src="./community-realtime\.js"></script>', '', content)
content = re.sub(r'<script src="./pwa\.js"></script>', '', content)

# Add them after player-bridge.js (the last core script)
content = content.replace(
    '<script src="./player-bridge.js"></script>',
    '<script src="./player-bridge.js"></script><script src="./presence.js"></script><script src="./wanted-realtime.js"></script><script src="./community-realtime.js"></script><script src="./pwa.js"></script>'
)

# Write back
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed script order')
