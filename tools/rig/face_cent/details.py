# Rigid face details on Centurion's head bone: 3D ears, tousled short hair locks over the scalp, beard tufts breaking the
# jaw/chin silhouette, plus two eye-emitter empties (eye_emit_L/R) sitting in the sculpted eye sockets for the eye beam.
import bpy, bmesh, math, random
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
SRC='/workspace/hero-game-assets/rig/cent_anim_face_s2.blend'
OUT='/workspace/hero-game-assets/rig/cent_anim_face.blend'
bpy.ops.wm.open_mainfile(filepath=SRC)
random.seed(11)
ao=bpy.data.objects['cent_rig']; ao.animation_data.action=None
for pb in ao.pose.bones: pb.rotation_quaternion=(1,0,0,0); pb.location=(0,0,0)
bpy.context.view_layer.update()
body=bpy.data.objects['cent_body']
bmb=bmesh.new(); bmb.from_mesh(body.data); bvh=BVHTree.FromBMesh(bmb)
def hit(origin, d):
    loc,nrm,i,dist=bvh.ray_cast(Vector(origin),Vector(d).normalized()); return loc,nrm
def mat(name, rough=0.8):
    m=bpy.data.materials.new(name); m.use_nodes=True; nt=m.node_tree; bs=nt.nodes['Principled BSDF']
    ca=nt.nodes.new('ShaderNodeVertexColor'); ca.layer_name='Col'; nt.links.new(ca.outputs[0],bs.inputs['Base Color'])
    bs.inputs['Roughness'].default_value=rough; return m
M_HAIR=mat('cent_face_hair',0.55); M_SKIN=mat('cent_face_skin',0.6)
bm=bmesh.new(); col=bm.loops.layers.color.new('Col')
def lin(c): return tuple(((x/255)**2.2) for x in c)+(1,)
CARD={}
def tube(path, radii, colors, mi, sides=4, flat=1.0, nh=None):
    rings=[]
    for i,p in enumerate(path):
        t=(path[min(i+1,len(path)-1)]-path[max(i-1,0)]).normalized()
        a=t.cross(nh).normalized(); bb=t.cross(a).normalized(); r=radii[i]; ring=[]
        for k in range(sides):
            th=2*math.pi*k/sides+math.pi/sides; vv=bm.verts.new(p+a*math.cos(th)*r+bb*math.sin(th)*r*flat); ring.append(vv); CARD[vv]=nh.copy()
        rings.append((ring,colors[i]))
    for i in range(len(rings)-1):
        (r0,c0),(r1,c1)=rings[i],rings[i+1]
        for k in range(sides):
            try: f=bm.faces.new([r0[k],r0[(k+1)%sides],r1[(k+1)%sides],r1[k]])
            except ValueError: continue
            f.material_index=mi
            for l in f.loops: l[col]=lin(c0 if l.vert in r0 else c1)
def lock(root,n,d,L,w,cs,mi,lift,curl=0.0,flat=0.3):
    d=(d-n*d.dot(n)).normalized(); side=d.cross(n)
    pts=[root+d*L*t+n*(0.0015+lift*t*t)+side*curl*L*t*t for t in (0,0.4,0.75,1.0)]
    tube(pts,[w,w*0.85,w*0.5,w*0.12],cs,mi,sides=3,flat=flat,nh=n)
C=Vector((0,-0.025,1.715))
def hairline(ax):  # front hairline height (from the design: center 1.789, temples drop to ~1.736)
    pts=[(0,1.789),(0.03,1.787),(0.056,1.775),(0.072,1.752),(0.085,1.735)]
    for (a0,z0),(a1,z1) in zip(pts,pts[1:]):
        if ax<=a1: return z0+(ax-a0)/(a1-a0)*(z1-z0)
    return 1.735
DARK=(30,21,16); MID=(50,35,26); TIP=(84,61,44)
# --- hair: tousled short locks over the scalp (front ones flick up and forward like the art; sides sweep back/down)
nh=0
for i in range(4000):
    u=random.uniform(-1,1); th=random.uniform(0,2*math.pi); r=math.sqrt(1-u*u)
    dirv=Vector((r*math.cos(th),r*math.sin(th),u))
    if dirv.z<-0.25: continue
    o=C+dirv*0.4; loc,n=hit(o,-dirv)
    if loc is None or n.dot(dirv)<0.2: continue
    x,y,z=loc; ax=abs(x)
    if y<-0.07 and z<hairline(ax): continue           # face
    if z<1.735 and y<0.03: continue                    # ears / sideburns (beard texture handles these)
    if z<1.665: continue                               # nape
    if y<-0.07 and z<hairline(ax)+0.006 and random.random()<0.5: continue
    top=Vector((0,0,1)); back=Vector((0,1,0))
    front=y<-0.06
    if front:   d=Vector((random.uniform(-0.6,0.6),-0.2,1.0))           # flicks up off the hairline
    elif z>1.8: d=Vector((x*4+random.uniform(-0.5,0.5),1.0,0.15))        # top: swept back
    else:       d=Vector((0,0.7,-0.6))+Vector((random.uniform(-0.2,0.2),0,0))  # sides/back: down and back
    L=random.uniform(0.013,0.021)*(0.85 if not front else 1.0); w=random.uniform(0.0035,0.0055)
    j=random.uniform(0.75,1.25); cs=[tuple(min(255,int(c*j)) for c in cc) for cc in (DARK,MID,MID,(70,50,36))]
    lock(loc-n*0.003,n,d,L,w,cs,0,lift=random.uniform(0.002,0.0065) if not front else random.uniform(0.004,0.008),curl=random.uniform(-0.3,0.3),flat=0.5)
    nh+=1
    if nh>=460: break
# --- beard tufts: break the chin/jaw silhouette (point down, a little forward)
nb=0
for i in range(3000):
    x=random.uniform(-0.095,0.095); z=random.uniform(1.60,1.645)
    loc,n=hit(Vector((x*3,-0.35,z)),Vector((-x*3+x,0.35,0)))
    if loc is None or n.y>-0.15 or loc.y>-0.02: continue
    if abs(loc.x)<0.03 and loc.z>1.635: continue        # keep the lips clear
    d=Vector((loc.x*1.5,-0.35,-1.0))
    lock(loc-n*0.0035,n,d,random.uniform(0.009,0.015),random.uniform(0.0035,0.005),[(26,18,14),(34,24,18),(44,31,23),(56,40,29)],0,lift=random.uniform(0.0015,0.004),curl=random.uniform(-0.3,0.3),flat=0.5)
    nb+=1
    if nb>=170: break
print('hair locks',nh,'beard tufts',nb)
# --- ears: cupped shells with a rolled rim, attached at the front edge, back edge standing out from the head
SKIN=(128,86,66); SKIN_D=(92,58,44); SKIN_R=(140,94,72)
for s in (-1,1):
    loc,n=hit(Vector((s*0.3,-0.022,1.708)),Vector((-s,0,0)))
    base=loc-Vector((s*0.004,0,0))
    up=Vector((0,0.18,1)).normalized(); back=Vector((0,1,0)); out=Vector((s,0,0))
    H=0.056; Wd=0.028; rows=8; cols=6
    def P(t,u,inner=False):
        z=(t-0.5)*H; wf=math.sqrt(max(0.0,1-(2*t-1)**2))*(0.85+0.3*t)    # wider at the top, lobe at the bottom
        b=(u+1)/2*Wd*wf
        pro=0.002+0.010*(u+1)/2*(0.6+0.4*t)*min(1.0,wf*1.6)
        cup=-0.0035*(1-u*u)*math.sin(math.pi*t)
        p=base+up*z+back*b+out*(pro+cup)
        return p-out*0.004 if inner else p
    front=[[bm.verts.new(P(i/rows,k/cols*2-1)) for k in range(cols+1)] for i in range(rows+1)]
    backs=[[bm.verts.new(P(i/rows,k/cols*2-1,True)) for k in range(cols+1)] for i in range(rows+1)]
    def cf(i,k):
        t=i/rows; u=k/cols*2-1
        return SKIN_R if (u>0.6 or t>0.85) else (SKIN_D if (abs(u)<0.5 and 0.25<t<0.75) else SKIN)
    for i in range(rows):
        for k in range(cols):
            for G,rev,cc in ((front,False,cf),(backs,True,lambda i,k:SKIN)):
                vs=[G[i][k],G[i][k+1],G[i+1][k+1],G[i+1][k]]
                if rev: vs=vs[::-1]
                if s<0: vs=vs[::-1]
                try: f=bm.faces.new(vs)
                except ValueError: continue
                f.material_index=1; ids={G[i][k]:(i,k),G[i][k+1]:(i,k+1),G[i+1][k+1]:(i+1,k+1),G[i+1][k]:(i+1,k)}
                for l in f.loops: l[col]=lin(cc(*ids[l.vert]))
    for i in range(rows):   # rim along the back edge + top/bottom
        vs=[front[i][cols],front[i+1][cols],backs[i+1][cols],backs[i][cols]]
        if s>0: vs=vs[::-1]
        try:
            f=bm.faces.new(vs); f.material_index=1
            for l in f.loops: l[col]=lin(SKIN_R)
        except ValueError: pass
bmesh.ops.recalc_face_normals(bm,faces=[f for f in bm.faces if f.material_index==1])
bm.verts.index_update(); cardn={v.index:n for v,n in CARD.items()}
me=bpy.data.meshes.new('CentFaceDetail'); bm.to_mesh(me); bm.free()
for p in me.polygons: p.use_smooth=True
for m in (M_HAIR,M_SKIN): me.materials.append(m)
me.normals_split_custom_set_from_vertices([tuple(cardn[v.index]) if v.index in cardn else tuple(v.normal) for v in me.vertices])
ob=bpy.data.objects.new('CentFaceDetail',me); bpy.context.scene.collection.objects.link(ob)
def to_head(o):
    mw=o.matrix_world.copy(); o.parent=ao; o.parent_type='BONE'; o.parent_bone='head'; bpy.context.view_layer.update(); o.matrix_world=mw
to_head(ob)
# --- eye emitters: on the surface at the centre of each sculpted socket (+4 mm), matching the projected glowing eyes
for s,nm in ((-1,'eye_emit_R'),(1,'eye_emit_L')):
    loc,n=hit(Vector((s*0.037,-0.3,1.722)),Vector((0,1,0)))
    e=bpy.data.objects.new(nm,None); e.empty_display_size=0.01; bpy.context.scene.collection.objects.link(e)
    e.location=loc+Vector((0,-0.004,0)); bpy.context.view_layer.update(); to_head(e); print('EYE',nm,tuple(round(c,4) for c in loc))
print('detail tris',sum(len(p.vertices)-2 for p in me.polygons),'verts',len(me.vertices))
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('DONE')
