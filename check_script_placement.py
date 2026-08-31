# Read index.html
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Check if player-bridge.js is present
if 'player-bridge.js' in content:
    print('player-bridge.js found')
    # Find the position
    pos = content.find('player-bridge.js')
    print(f'Position: {pos}')
    # Show context around it
    start = max(0, pos - 100)
    end = min(len(content), pos + 200)
    print('Context:', content[start:end])
else:
    print('player-bridge.js NOT found')

# Check for presence.js
if 'presence.js' in content:
    print('presence.js found')
else:
    print('presence.js NOT found')
