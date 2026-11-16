# Rigid face details on the head bone: big pointed ears, flaming cheek ruff, white chin tuft, 3D fangs, nose pad.
import bpy, bmesh, math, random
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
SRC='/workspace/hero-game-assets/rig/tiger_anim_face_s2.blend'
OUT='/workspace/hero-game-assets/rig/tiger_anim_face.blend'
bpy.ops.wm.open_mainfile(filepath=SRC)
random.seed(7)
ao=bpy.data.objects['tiger_rig']; ao.animation_data.action=None
for pb in ao.pose.bones: pb.rotation_quaternion=(1,0,0,0); pb.location=(0,0,0)
bpy.context.view_layer.update()
body=bpy.data.objects['tiger_body']
bmb=bmesh.new(); bmb.from_mesh(body.data); bvh=BVHTree.FromBMesh(bmb)
def hit(origin, d):
    loc,nrm,i,dist=bvh.ray_cast(Vector(origin),Vector(d).normalized()); return loc,nrm
def mat(name, emis=None, rough=0.8):
    m=bpy.data.materials.new(name); m.use_nodes=True; nt=m.node_tree; bs=nt.nodes['Principled BSDF']
    ca=nt.nodes.new('ShaderNodeVertexColor'); ca.layer_name='Col'; nt.links.new(ca.outputs[0],bs.inputs['Base Color'])
    bs.inputs['Roughness'].default_value=rough
    if emis: bs.inputs['Emission Color'].default_value=(*emis,1); bs.inputs['Emission Strength'].default_value=1.0
    return m
M_FUR=mat('tiger_face_fur'); M_FLAME=mat('tiger_face_flame',emis=(1.0,0.42,0.06)); M_HORN=mat('tiger_face_fang',rough=0.35)
bm=bmesh.new(); col=bm.loops.layers.color.new('Col')
def lin(c): return tuple(((x/255)**2.2) for x in c)+(1,)
CARD={}
def tube(path, radii, colors, mats, sides=5, flat=1.0, nh=None, card=False):
    """path: list of Vectors; radii per point; colors per point (sRGB 0-255); mats: material index per segment"""
    rings=[]
    for i,p in enumerate(path):
        t=(path[min(i+1,len(path)-1)]-path[max(i-1,0)]).normalized()
        up=nh if nh is not None else (Vector((0,0,1)) if abs(t.z)<0.9 else Vector((1,0,0)))
        a=t.cross(up).normalized(); bb=t.cross(a).normalized()
        r=radii[i]; ring=[]
        for k in range(sides):
            th=2*math.pi*k/sides; vv=bm.verts.new(p+a*math.cos(th)*r+bb*math.sin(th)*r*flat); ring.append(vv)
            if card: CARD[vv]=nh.copy()
        rings.append((ring,colors[i]))
    for i in range(len(rings)-1):
        (r0,c0),(r1,c1)=rings[i],rings[i+1]
        for k in range(sides):
            vs=[r0[k],r0[(k+1)%sides],r1[(k+1)%sides],r1[k]]
            try: f=bm.faces.new(vs)
            except ValueError: continue
            f.material_index=mats[i]
            for l in f.loops: l[col]=lin(c0 if l.vert in r0 else c1)
    r0,c0=rings[0]
    try:
        f=bm.faces.new(list(reversed(r0))); f.material_index=mats[0]
        for l in f.loops: l[col]=lin(c0)
    except ValueError: pass
def bez(p0,p1,p2,n):
    return [p0*(1-t)**2+p1*2*t*(1-t)+p2*t*t for t in [i/(n-1) for i in range(n)]]
WHITE=(245,236,220); CREAM=(250,214,160); ORANGE=(236,120,30); DEEP=(200,70,15); YEL=(255,214,90); DARK=(40,22,14); PINK=(214,120,110)
# --- cheek ruff: flat fur locks lying along the cheeks and sweeping back (cream below, flame orange/yellow above)
def lock(root,n,d,L,w,cs,ms,lift=0.012):
    d=(d-n*d.dot(n)).normalized(); pts=[root+d*L*t+n*(0.002+lift*t*t) for t in (0,0.3,0.6,0.85,1.0)]
    tube(pts,[w,w*1.0,w*0.75,w*0.4,w*0.04],cs,ms,sides=5,flat=0.18,nh=n,card=True)
for s in (-1,1):
    for row in range(3):
        for j in range(8):
            z=1.865+j*0.017+row*0.0057+random.uniform(-0.003,0.003)
            yo=-0.05+0.018*row+0.003*j
            loc,n=hit(Vector((s*0.3,yo,z)),(-s,0,0))
            if loc is None: continue
            up=(z-1.865)/0.13
            d=Vector((s*0.3,0.9,-0.45+0.85*up)); L=0.045+0.02*math.sin(min(1,up)*math.pi)+random.uniform(-0.006,0.006)
            if up<0.35: cs=[ORANGE,ORANGE,(240,150,70),(246,190,130),(250,220,180)]; ms=[0,0,0,0]
            else: cs=[ORANGE,ORANGE,ORANGE,(248,150,45),(252,190,70)]; ms=[0,0,0,1]
            lock(loc-n*0.004,n,d,L,0.012,cs,ms,lift=0.007)
# --- temple flame locks tying the ruff into the mohawk like the art
for s in (-1,1):
    for j in range(3):
        loc,n=hit(Vector((s*0.3,-0.03+0.02*j,2.0+0.022*j)),(-s,0,0))
        if loc is None: continue
        lock(loc-n*0.004,n,Vector((s*0.3,0.7,0.65)),0.055,0.011,[ORANGE,ORANGE,(248,160,55),(252,195,80),YEL],[0,0,0,1],lift=0.012)
# --- 3D fangs at the corners of the painted snarl
for s in (-1,1):
    o=Vector((s*0.038,-0.3,1.875)); loc,n=hit(o,(0,1,0))
    if loc is None: continue
    root=loc+Vector((0,0.004,0)); tip=root+Vector((-s*0.002,-0.004,-0.022))
    tube(bez(root,(root+tip)/2+Vector((0,-0.003,0)),tip,4),[0.0055,0.0045,0.0025,0.0003],[(250,240,215)]*3+[(255,250,235)],[2,2,2],sides=6)
# --- big pointed ears (orange backs, dark rims, pale inner fur)
for s in (-1,1):
    base=Vector((s*0.097,0.03,2.085))
    out=Vector((s*math.sin(math.radians(24)),0,math.cos(math.radians(24))))
    fwd=Vector((s*0.35,-1,0)).normalized()
    side=out.cross(fwd).normalized()
    H=0.082; Wd=0.034; T=0.010
    rows=6; cols=5; grid=[]
    for i in range(rows+1):
        t=i/rows; w=Wd*(1-t)**0.8*(1+0.25*math.sin(t*math.pi)); cup=0.012*(1-t)
        row=[]
        for k in range(cols+1):
            u=k/cols*2-1
            p=base+out*(H*t)+side*(u*w)-fwd*(cup*(1-u*u))
            row.append(p)
        grid.append(row)
    front=[[bm.verts.new(p) for p in row] for row in grid]
    back=[[bm.verts.new(p+fwd*(-T*(1-0.7*i/rows))) for p in row] for i,row in enumerate(grid)]
    def cfront(i,k):
        t=i/rows; u=abs(k/cols*2-1)
        return DARK if (u>0.8 or t>0.85) else (PINK if (u<0.35 and t<0.55) else CREAM)
    def cback(i,k):
        t=i/rows; return DARK if t>0.7 else (DEEP if t>0.45 else ORANGE)
    for i in range(rows):
        for k in range(cols):
            for G,cf,rev in ((front,cfront,False),(back,cback,True)):
                vs=[G[i][k],G[i][k+1],G[i+1][k+1],G[i+1][k]]
                if rev: vs=vs[::-1]
                if s<0: vs=vs[::-1]
                try: f=bm.faces.new(vs)
                except ValueError: continue
                ids={G[i][k]:(i,k),G[i][k+1]:(i,k+1),G[i+1][k+1]:(i+1,k+1),G[i+1][k]:(i+1,k)}
                for l in f.loops: l[col]=lin(cf(*ids[l.vert]))
    for k in range(cols):  # close the base edge
        try:
            f=bm.faces.new([front[0][k],back[0][k],back[0][k+1],front[0][k+1]] if s>0 else [front[0][k+1],back[0][k+1],back[0][k],front[0][k]])
            for l in f.loops: l[col]=lin(ORANGE)
        except ValueError: pass
    for i in range(rows):  # rims
        for k,(a,b2) in ((0,(0,0)),(cols,(cols,cols))):
            vs=[front[i][k],front[i+1][k],back[i+1][k],back[i][k]]
            if (k==0)!=(s<0): vs=vs[::-1]
            try:
                f=bm.faces.new(vs)
                for l in f.loops: l[col]=lin(DARK)
            except ValueError: pass
bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
bm.verts.index_update(); cardn={v.index:n for v,n in CARD.items()}
me=bpy.data.meshes.new('TigerFaceDetail'); bm.to_mesh(me); bm.free()
for p in me.polygons: p.use_smooth=True
for m in (M_FUR,M_FLAME,M_HORN): me.materials.append(m)
me.normals_split_custom_set_from_vertices([tuple(cardn[v.index]) if v.index in cardn else tuple(v.normal) for v in me.vertices])
ob=bpy.data.objects.new('TigerFaceDetail',me); bpy.context.scene.collection.objects.link(ob)
mw=ob.matrix_world.copy()
ob.parent=ao; ob.parent_type='BONE'; ob.parent_bone='head'
bpy.context.view_layer.update()
ob.matrix_world=Matrix.Identity(4)
print('detail tris',sum(len(p.vertices)-2 for p in me.polygons),'verts',len(me.vertices))
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('DONE')
