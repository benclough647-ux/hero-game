# Tiger face sculpt: subdivide the front of the head, then displace it into a tiger muzzle / brow / sockets / cheeks / jaw.
import bpy, bmesh, math, sys
from mathutils import Vector
SRC='/workspace/hero-game-assets/rig/tiger_anim.blend'
OUT='/workspace/hero-game-assets/rig/tiger_anim_face_s1.blend'
bpy.ops.wm.open_mainfile(filepath=SRC)
b=bpy.data.objects['tiger_body']; me=b.data; hi=b.vertex_groups['head'].index
bm=bmesh.new(); bm.from_mesh(me)
dl=bm.verts.layers.deform.active
def hw(v): return v[dl].get(hi,0.0)
def ss(a,b,x):
    t=min(1,max(0,(x-a)/(b-a))); return t*t*(3-2*t)
def g(x,s): return math.exp(-(x/s)**2)
faces=[f for f in bm.faces if all(hw(v)>0.35 for v in f.verts) and f.calc_center_median().y<0.0 and f.calc_center_median().z<2.09]
edges=list({e for f in faces for e in f.edges})
print('subdiv faces',len(faces))
bmesh.ops.subdivide_edges(bm,edges=edges,cuts=2,use_grid_fill=True,smooth=0.6)
bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>4])
moved=0
for v in bm.verts:
    w=hw(v)
    if w<0.05: continue
    x,y,z=v.co; F=-y; ax=abs(x); sx=1 if x>=0 else -1
    ff=ss(-0.03,0.07,F)             # front-facing part of the head
    dF=dx=dz=0.0
    # muzzle block + whisker pads
    dF+=0.034*g(x,0.055)*ss(1.835,1.875,z)*(1-ss(1.95,1.985,z))
    dF+=0.012*g(ax-0.03,0.022)*g(z-1.893,0.02)
    # nose bridge (tapers up to the brow) and nose tip
    dF+=g(x,0.022)*ss(1.91,1.93,z)*(1-ss(1.985,2.03,z))*(0.022-0.12*(z-1.93))
    dF+=0.012*g(x,0.02)*g(z-1.922,0.014)
    # mouth line groove + philtrum
    dF-=0.006*g(ax,0.06)*g(z-(1.872-0.25*ax*ax/0.06),0.006)
    # chin
    dF+=0.012*g(x,0.04)*g(z-1.845,0.018)
    # eye sockets (deep-set) and angry brow ridge (inner end lower)
    dF-=0.017*g(ax-0.058,0.019)*g(z-1.998,0.012)
    zc=2.024+0.22*(ax-0.03)
    dF+=0.019*g(ax-0.056,0.036)*g(z-zc,0.011)
    dF-=0.006*g(x,0.009)*g(z-2.03,0.012)   # frown furrow between the brows
    # cheekbones / ruff base and jaw: widen the sides
    side=ss(0.055,0.085,ax)
    dx+=sx*0.022*side*g(z-1.935,0.045)
    dx+=sx*0.010*ss(0.05,0.08,ax)*g(z-1.855,0.02)
    dF+=0.006*ss(0.05,0.08,ax)*g(z-1.86,0.02)
    k=w*ff
    v.co.y-=dF*k; v.co.x+=dx*w*ss(-0.08,0.0,F); v.co.z+=dz*k
    if abs(dF*k)+abs(dx)>1e-4: moved+=1
print('moved',moved)
bm.to_mesh(me); bm.free(); me.update()
for p in me.polygons: p.use_smooth=True
print('verts',len(me.vertices))
bpy.ops.wm.save_as_mainfile(filepath=OUT)
