"""Batch 27 - cover thumbnails.

The covers are 400x400 up to 1024x1024 PNGs. The largest is 11 MB. The
player draws them at 24-28 pixels. The credits wall draws them at 150.
So the site was downloading 250 KB of picture to paint a 24 pixel square.

Three tiers, each 2x the size it is drawn at, so they stay sharp on a
retina screen:

    64   the track list rows, the mini cover, the queue items
    128  the stat art, trending, recent, the mobile player
    320  the credits wall, the info panel cover
    640  the cover view, the lightbox

WebP, quality 72, method 6. The output is measured, not guessed - the
script prints the before and after.
"""
import os
from PIL import Image

ROOT = "D:/TheHighWRLD Dashboard"
SRC = os.path.join(ROOT, "Covers")
DST = os.path.join(SRC, "thumbs")

TIERS = [("64", 64), ("128", 128), ("320", 320), ("640", 640)]

# Never larger than the source, and never upscaled.
MAX_QUALITY = 72

total_before = 0
total_after = 0
count = 0
per_tier = {}

for tier_name, box in TIERS:
    out_dir = os.path.join(DST, tier_name)
    os.makedirs(out_dir, exist_ok=True)
    tier_bytes = 0
    tier_n = 0
    for name in sorted(os.listdir(SRC)):
        path = os.path.join(SRC, name)
        if not os.path.isfile(path):
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext not in (".png", ".jpg", ".jpeg", ".webp"):
            continue
        before = os.path.getsize(path)
        total_before += before
        try:
            with Image.open(path) as im:
                im = im.convert("RGB")
                # A thumbnail never grows the picture.
                if im.width > box or im.height > box:
                    im.thumbnail((box, box), Image.LANCZOS)
                # The extension stays in the name: Covers/Floating.jpg and
                # Covers/Floating.png are two different pictures with the same
                # name, and dropping the extension let one overwrite the other.
                out_path = os.path.join(out_dir, name + ".webp")
                im.save(out_path, "WEBP", quality=MAX_QUALITY, method=6)
            after = os.path.getsize(out_path)
            tier_bytes += after
            tier_n += 1
            total_after += after
            count += 1
        except Exception as e:
            print("  !! could not do", name, e)
    per_tier[tier_name] = (tier_n, tier_bytes)
    print("tier %-4s %3d files  %7.1f KB" % (tier_name, tier_n, tier_bytes / 1024))

print()
print("source covers : %d files, %.1f MB" % (count, total_before / 1024 / 1024))
print("thumbnails    : %d files, %.1f MB" % (count, total_after / 1024 / 1024))
print("one visit of the player list is 250 rows: %.1f MB -> %.2f MB"
      % (250 * (total_before / count) / 1024 / 1024,
         250 * (per_tier["64"][1] / per_tier["64"][0]) / 1024 / 1024))
