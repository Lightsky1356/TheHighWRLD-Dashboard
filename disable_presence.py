import re

# Read index.html
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Comment out presence.js script tag
new_content = re.sub(
    r'<script src="\.\/presence\.js"><\/script>',
    '<!-- presence.js temporarily disabled for testing -->',
    content
)

# Write back
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(new_content)

print('Disabled presence.js for testing')
