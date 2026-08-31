# Check if the good deployment has encoding corruption
with open('index_good.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Check for common mojibake patterns
mojibake_patterns = ['ðŸŽµ', 'ðŸŒ', 'ðŸ“œ', 'â”â”']

has_corruption = False
for pattern in mojibake_patterns:
    if pattern in content:
        print(f'Found corruption pattern: {pattern}')
        has_corruption = True

if has_corruption:
    print('Good deployment ALSO has encoding corruption')
else:
    print('Good deployment has clean encoding')
