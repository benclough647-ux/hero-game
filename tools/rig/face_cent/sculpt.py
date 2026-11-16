# Centurion face sculpt: subdivide the front of the head, then displace it into a human face matched to Ben's design:
# heavy brow ridge, deep-set eye sockets, strong straight nose, cheekbones, moustache/lips, full square beard and jaw.
# Ref mapping (cent_face_raw.png, 274x358 crop of the design sheet): x = (px-140)*0.0007, z = 1.722-(py-150)*0.0007.
import bpy, bmesh, math
SRC='/workspace/hero-game-assets/rig/cent_anim.blend'
OUT='/workspace/hero-game-assets/rig/cent_anim_face_s1.blend'
bpy.ops.wm.open_mainfile(filepath=SRC)
b=bpy.data.objects['cent_body']; me=b.data; hi=b.vertex_groups['head'].index
me.calc_normals_split() if hasattr(me,'calc_normals_split') else None
ON={}
for l in me.loops: ON.setdefault(l.vertex_index,[]).append(l.normal.copy())
from mathutils import Vector
ONV={i:sum(ns,Vector()).normalized() for i,ns in ON.items()}
bm=bmesh.new(); bm.from_mesh(me)
oid=bm.verts.layers.int.new('oid')
for v in bm.verts: v[oid]=v.index+1
dl=bm.verts.layers.deform.active
def hw(v): return v[dl].get(hi,0.0)
def ss(a,b,x):
    t=min(1,max(0,(x-a)/(b-a))); return t*t*(3-2*t)
def g(x,s): return math.exp(-(x/s)**2)
faces=[f for f in bm.faces if all(hw(v)>0.3 for v in f.verts) and f.calc_center_median().y<-0.02 and 1.565<f.calc_center_median().z<1.80]
edges=list({e for f in faces for e in f.edges})
print('subdiv faces',len(faces))
bmesh.ops.subdivide_edges(bm,edges=edges,cuts=3,use_grid_fill=True,smooth=0.5)
bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>4])
# replace the noisy, lopsided scanned base on the face with a clean symmetric surface: per height, fit y = a + b*x^2 + c*x^4
# to the original front verts, then blend the face onto it (fading back to the original towards the sides/top/neck)
import numpy as np
base=[(v.co.x,v.co.y,v.co.z) for v in bm.verts if hw(v)>0.4 and v.co.y<-0.03]
base=np.array(base)
def fit(z):
    m=np.abs(base[:,2]-z)<0.009
    X=base[m,0]; Y=base[m,1]
    A=np.stack([np.ones_like(X),X**2,X**4],1); c=np.linalg.lstsq(A,Y,rcond=None)[0]; return c
FIT={}
for v in bm.verts:
    w=hw(v)
    if w<0.3 or v.co.y>-0.02 or not (1.565<v.co.z<1.81): continue
    x,y,z=v.co; zk=round(z,3)
    if zk not in FIT: FIT[zk]=fit(zk)
    c=FIT[zk]; yf=c[0]+c[1]*x*x+c[2]*x**4
    m=ss(0.4,0.7,w)*(1-ss(0.06,0.085,abs(x)))*ss(1.572,1.59,z)*(1-ss(1.785,1.805,z))
    v.co.y=y+(yf-y)*m
EYEZ=1.722; EYEX=0.037
moved=0
for v in bm.verts:
    w=hw(v)
    if w<0.05: continue
    x,y,z=v.co; F=-y; ax=abs(x); sx=1 if x>=0 else -1
    ff=ss(0.0,0.09,F)              # front-facing part of the head
    dF=dx=dz=0.0
    # --- forehead: gentle frontal bossing, flattening towards the hairline
    dF+=0.004*g(ax-0.025,0.03)*g(z-1.762,0.018)
    # --- heavy brow ridge (stern: inner ends lower, slight downward angle), frown furrows between the brows
    zc=1.737-0.10*max(0,0.03-ax)+0.04*max(0,ax-0.045)
    dF+=0.014*g(ax-0.036,0.026)*g(z-zc,0.0075)*(1-0.4*ss(0.05,0.075,ax))
    dF-=0.0035*g(ax-0.006,0.004)*g(z-1.74,0.009)
    dF+=0.003*g(x,0.006)*g(z-1.733,0.006)     # procerus bump between the brows
    # --- deep-set eye sockets + upper lid crease + under-eye bags
    dF-=0.013*g(ax-EYEX,0.017)*g(z-EYEZ,0.0085)
    dF+=0.0025*g(ax-EYEX,0.012)*g(z-1.711,0.004)
    # --- nose: bridge (narrow, rising from the brows), tip, alar wings, nostril shadow, columella undercut
    br=ss(1.676,1.69,z)*(1-ss(1.725,1.738,z))
    dF+=br*g(x,0.0075+0.004*ss(1.73,1.69,z))*(0.005+0.016*ss(1.733,1.688,z))
    dF+=0.012*g(x,0.0095)*g(z-1.6845,0.006)*ss(1.663,1.679,z)
    dF+=0.008*g(ax-0.0125,0.006)*g(z-1.680,0.005)
    dF-=0.004*g(ax-0.022,0.004)*g(z-1.683,0.010)  # nasolabial start beside the wings
    # --- cheekbones and hollow below them (strong, square face)
    dF+=0.007*g(ax-0.056,0.016)*g(z-1.704,0.012)
    dx+=sx*0.006*ss(0.05,0.075,ax)*g(z-1.705,0.02)
    dF-=0.003*g(ax-0.05,0.012)*g(z-1.682,0.008)
    # --- moustache / upper lip mound, lips, mouth line
    dF+=0.010*g(ax,0.028)*g(z-1.662,0.009)
    dF+=0.004*g(ax,0.017)*g(z-1.648,0.004)
    dF-=0.004*g(ax,0.02)*g(z-1.6535,0.0025)
    # --- full beard: square chin mass pushed forward/down, beard bulk along the jaw, square jaw corners
    dF+=0.015*g(ax,0.035)*g(z-1.616,0.02)*ss(1.57,1.59,z)
    dF+=0.008*g(ax-0.055,0.03)*g(z-1.625,0.022)
    dx+=sx*0.010*ss(0.04,0.08,ax)*g(z-1.625,0.025)
    dz-=0.006*g(ax,0.04)*g(z-1.592,0.012)
    k=w*ff
    v.co.y-=dF*k; v.co.x+=dx*w*ss(-0.04,0.03,F); v.co.z+=dz*k
    if abs(dF*k)+abs(dx)>1e-4: moved+=1
print('moved',moved)
bm.to_mesh(me); bm.free(); me.update()
bm2=bmesh.new(); bm2.from_mesh(me); oidl=bm2.verts.layers.int['oid']; dl2=bm2.verts.layers.deform.active
ids=[v[oidl] for v in bm2.verts]; hws=[v[dl2].get(hi,0.0) for v in bm2.verts]; bm2.free()
bpy.context.view_layer.objects.active=b; bpy.ops.mesh.customdata_custom_splitnormals_clear()
for p in me.polygons: p.use_smooth=True
me.update()
NN=[]
for v,i,w in zip(me.vertices,ids,hws):
    t=ss(0.15,0.4,w)*ss(1.54,1.57,v.co.z) if i>0 else 1.0
    if i>0 and t<1: NN.append(tuple((ONV[i-1]*(1-t)+v.normal*t).normalized()))
    else: NN.append(tuple(v.normal))
me.normals_split_custom_set_from_vertices(NN)
me.attributes.remove(me.attributes['oid'])
print('verts',len(me.vertices))
bpy.ops.wm.save_as_mainfile(filepath=OUT)
