import cv2, numpy as np
im=cv2.imread('/workspace/hero-game-assets/tiger_mainhead_raw.png'); H,W=im.shape[:2]
hsv=cv2.cvtColor(im,cv2.COLOR_BGR2HSV).astype(int)
v=im.max(2).astype(int)
fg=(v>40).astype(np.uint8)
# drop the red cape + gold clasps in the lower part (strongly red/low green, or below the chin fur sides)
b,g,r=[im[...,i].astype(int) for i in range(3)]
yy,xx=np.mgrid[0:H,0:W]
cape=((r>90)&(g<0.42*r)&(b<0.5*r)&(yy>560))
clasp=(yy>720)&((xx<140)|(xx>620))
fg[cape|clasp]=0
fg[yy>770]=0
# keep the biggest component, close holes, soften edge
fg=cv2.morphologyEx(fg,cv2.MORPH_OPEN,np.ones((5,5),np.uint8))
n,lab,st,_=cv2.connectedComponentsWithStats(fg)
k=1+np.argmax(st[1:,cv2.CC_STAT_AREA]); fg=(lab==k).astype(np.uint8)
fg=cv2.morphologyEx(fg,cv2.MORPH_CLOSE,np.ones((15,15),np.uint8))
cnts,_=cv2.findContours(fg,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE); fill=np.zeros_like(fg); cv2.drawContours(fill,cnts,-1,1,-1); fg=fill
a=cv2.GaussianBlur(fg.astype(np.float32),(0,0),1.5)
# also fade dim flame fringe so the matte isn't a hard black halo
dist=cv2.distanceTransform(fg,cv2.DIST_L2,5); edge=np.clip(1-dist/14,0,1)
a=a*(1-edge*(1-np.clip((v-60)/50,0,1))).astype(np.float32)
x,y,w,h=cv2.boundingRect((a>0.05).astype(np.uint8))
rgba=np.dstack([im,(a*255).astype(np.uint8)])[y:y+h,x:x+w]
S=int(max(w,h)*1.12); out=np.zeros((S,S,4),np.uint8); oy=(S-h)//2; ox=(S-w)//2; out[oy:oy+h,ox:ox+w]=rgba
out=cv2.resize(out,(1024,1024),interpolation=cv2.INTER_LANCZOS4)
cv2.imwrite('/workspace/hero-game-assets/trellis/tiger_head_input.png',out)
# preview on grey
p=out[...,:3].astype(float)*(out[...,3:]/255)+np.array([128,128,128])*(1-out[...,3:]/255)
cv2.imwrite('/workspace/hero-game-assets/trellis/tiger_head_input_preview.png',cv2.resize(p.astype(np.uint8),(512,512)))
print('bbox',x,y,w,h)
