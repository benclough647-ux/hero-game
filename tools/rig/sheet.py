import sys, glob, os
from PIL import Image, ImageDraw
name = sys.argv[1]; out = sys.argv[2]
SHOTS = [('idle', 0, 30), ('run', 3, 60), ('run', 11, 60), ('air', 10, 30), ('punch', 7, 40), ('blast', 6, 30),
         ('tackle', 12, 70), ('fly_hover', 12, 30), ('fly_fast', 6, 60), ('fly_fast', 6, 180), ('hit', 3, 30), ('fall', 5, 30), ('getup', 8, 60), ('down', 0, 60), ('blast', 6, 90), ('tackle', 12, 90), ('getup', 9, 90), ('fly_fast', 6, 90)]
S = 340; cols = 7; rows = (len(SHOTS) + cols - 1) // cols
W = Image.new('RGB', (S * cols, (S + 22) * rows), 'white'); d = ImageDraw.Draw(W)
for i, (c, f, az) in enumerate(SHOTS):
    p = f'/tmp/prev_{name}/{c}_{f}_{az}.png'
    if not os.path.exists(p): continue
    x, y = (i % cols) * S, (i // cols) * (S + 22)
    W.paste(Image.open(p), (x, y + 22)); d.text((x + 6, y + 5), f'{name} {c} f{f} az{az}', fill='black')
W.save(out); print(out)
