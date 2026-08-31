# Check if index.html has encoding corruption
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Check for common mojibake patterns
mojibake_patterns = ['ðŸŽµ', 'ðŸŒ', 'ðŸ“œ', 'â”â”']

has_corruption = False
for pattern in mojibake_patterns:
    if pattern in content:
        print(f'Found corruption pattern: {pattern}')
        has_corruption = True

if has_corruption:
    print('index.html has encoding corruption that needs to be fixed')
else:
    print('index.html encoding appears clean')
