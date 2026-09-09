import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
f=open('index.html','r',encoding='utf-8').read()
idx=f.find('id="wrldlog-overlay"')
print(f"Overlay HTML: ...{f[max(0,idx-20):idx+80]}...")
has_hidden='hidden' in f[max(0,idx-30):idx+10]
print(f"Has hidden class: {has_hidden}")

# Also check: does the overlay initially block the page?
# Check if wrldlog-overlay has 'hidden' in its class
class_start=f.rfind('class="',0,idx)
class_end=f.find('"',class_start+7)
print(f"Full class: {f[class_start:class_end+1]}")
