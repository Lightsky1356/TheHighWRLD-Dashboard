import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
f=open('tracks.js','r',encoding='utf-8').read()

# Find the array assignment
idx = f.find('[')
print("First [ at: %d" % idx)
print("Context: " + f[max(0,idx-50):idx+100])

# Find the end
last_bracket = f.rfind(']')
print("\nLast ] at: %d" % last_bracket)
print("Context after: " + f[last_bracket:last_bracket+50])

# Show last 300 chars
print("\nLast 300 chars:")
print(f[-300:])
