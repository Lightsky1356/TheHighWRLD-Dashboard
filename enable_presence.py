import re

# Read index.html
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Re-enable presence.js script tag
new_content = re.sub(
    r'<!-- presence\.js temporarily disabled for testing -->',
    '<script src="./presence.js"></script>',
    content
)

# Write back
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(new_content)

print('Re-enabled presence.js')
