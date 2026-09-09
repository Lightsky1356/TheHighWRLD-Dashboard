import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
f=open('tracks.js','r',encoding='utf-8').read()
# Get first 3 tracks to understand structure
idx=f.find('[{')
count=0
brace=0
start=idx
for i in range(idx, len(f)):
    if f[i]=='{':
        if count==0: start=i
        brace+=1
    elif f[i]=='}':
        brace-=1
        if brace==0:
            count+=1
            print(f"Track {count}: {f[start:i+1]}")
            print()
            if count>=2: break
