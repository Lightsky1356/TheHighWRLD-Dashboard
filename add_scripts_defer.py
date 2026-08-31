import re

# Read index.html
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Add the new scripts after player-bridge.js with defer attributes
content = content.replace(
    '<script src="./player-bridge.js" defer=""></script>',
    '<script src="./player-bridge.js" defer=""></script><script src="./presence.js"></script><script src="./wanted-realtime.js"></script><script src="./community-realtime.js"></script><script src="./pwa.js"></script>'
)

# Write back
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Added new scripts after player-bridge.js')
