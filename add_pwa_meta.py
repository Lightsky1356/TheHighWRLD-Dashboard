import re

# Read the restored index.html
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Add PWA meta tags after the title if not present
if 'manifest.webmanifest' not in content:
    # Find the title tag and add PWA meta after it
    content = re.sub(
        r'(<title>TheHighWRLD Dashboard</title>)',
        r'\1<link rel="manifest" href="./manifest.webmanifest"><meta name="theme-color" content="#c026d3"><link rel="apple-touch-icon" href="./icons/apple-touch-icon.png"><link rel="icon" type="image/png" sizes="192x192" href="./icons/icon-192.png"><link rel="icon" type="image/png" sizes="512x512" href="./icons/icon-512.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="TheHighWRLD">',
        content
    )

# Write back
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Added PWA meta tags')
