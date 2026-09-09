import os, re
os.chdir(os.path.dirname(os.path.abspath(__file__)))
f=open('tracks.js','r',encoding='utf-8').read()

# Find all titles
titles = re.findall(r'title:\s*"([^"]+)"', f)
print(f"Total tracks: {len(titles)}")

# Show last 3
for t in titles[-3:]:
    print(f"  {t}")

# Check which of the new songs might already exist
new_songs = ['Analog', 'By Myself', 'Flintstones', 'Circles', 'Dark Queen', 'Dummy', 'Flaws', 'Already Dead', 'In Zone', 'Submission']
for s in new_songs:
    found = [t for t in titles if s.lower() in t.lower()]
    if found:
        print(f"  ALREADY EXISTS: {s} -> {found}")
