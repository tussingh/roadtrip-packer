"""Render the PWA icons (milestone stone on highway-sign green) with Pillow."""
from PIL import Image, ImageDraw

GREEN = (14, 94, 70)
YELLOW = (242, 183, 5)
INK = (35, 41, 46)
WHITE = (255, 255, 255)

def icon(size, scale=1.0, rounded=True):
    S = size * 4  # supersample
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=GREEN)
    else:
        d.rectangle([0, 0, S, S], fill=GREEN)
    w = S * 0.44 * scale
    cx = S / 2
    left, right = cx - w / 2, cx + w / 2
    r = w / 2
    dome_y = S * 0.5 - (S * 0.08 * scale)
    bottom = S * 0.5 + S * 0.30 * scale
    line = max(2, int(S * 0.018 * scale))
    # body
    d.rectangle([left, dome_y, right, bottom], fill=WHITE)
    d.pieslice([left, dome_y - r, right, dome_y + r], 180, 360, fill=YELLOW)
    d.arc([left, dome_y - r, right, dome_y + r], 180, 360, fill=INK, width=line)
    d.line([left, dome_y, left, bottom], fill=INK, width=line)
    d.line([right, dome_y, right, bottom], fill=INK, width=line)
    d.line([left, dome_y, right, dome_y], fill=INK, width=line)
    # tick
    t = w * 0.18
    cy = dome_y + (bottom - dome_y) * 0.5
    pts = [(cx - t * 1.3, cy), (cx - t * 0.3, cy + t), (cx + t * 1.5, cy - t * 0.9)]
    d.line(pts, fill=GREEN, width=int(S * 0.04 * scale), joint='curve')
    # ground line
    gy = bottom + S * 0.04 * scale
    d.line([cx - w * 0.85, gy, cx + w * 0.85, gy], fill=(255, 255, 255, 140), width=int(S * 0.025 * scale))
    return img.resize((size, size), Image.LANCZOS)

icon(192).save('public/icons/icon-192.png')
icon(512).save('public/icons/icon-512.png')
icon(512, scale=0.78, rounded=False).save('public/icons/icon-maskable-512.png')
icon(180, rounded=False).save('public/icons/apple-touch-icon.png')
print('icons written')
