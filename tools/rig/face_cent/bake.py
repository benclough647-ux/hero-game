# Project Ben's Centurion face art (cent_face_raw.png: 274x358 crop of the design sheet's face panel) onto the sculpted head and bake it into the body atlas (albedo + emissive eyes), flatten old normal detail there.
import bpy, bmesh, math, numpy as np, sys, os
SRC='/workspace/hero-game-assets/rig/cent_anim_face_s1.blend'
OUT='/workspace/hero-game-assets/rig/cent_anim_face_s2.blend'
TEX='/workspace/hero-game-assets/rig/face_tex'; os.makedirs(TEX,exist_ok=True)
REF='/workspace/hero-game-assets/cent_face_raw_clean.png'; REFE='/workspace/hero-game-assets/rig/face_tex/cent_ref_emit.png'
bpy.ops.wm.open_mainfile(filepath=SRC)
ao=bpy.data.objects['cent_rig']; ao.animation_data.action=None
for pb in ao.pose.bones: pb.rotation_quaternion=(1,0,0,0); pb.location=(0,0,0)
b=bpy.data.objects['cent_body']; me=b.data; hi=b.vertex_groups['head'].index
RW,RH=274,358; SX=0.0007; U0=140   # x = (px-140)*0.0007, z = 1.722-(py-150)*0.0007 (same mapping as sculpt.py)
def vpx(z): return 150+(1.722-z)/SX
def ss(a,b,x):
    t=min(1,max(0,(x-a)/(b-a))); return t*t*(3-2*t)
# projection UVs + weight attribute
pu=me.uv_layers.new(name='proj'); orig_uv=me.uv_layers['UVMap']
me.uv_layers.active=orig_uv
W=np.zeros(len(me.vertices))
for v in me.vertices:
    hw=sum(g.weight for g in v.groups if g.group==hi)
    x,y,z=v.co; facing=-v.normal.y
    W[v.index]=ss(0.4,0.8,hw)*ss(0.1,0.5,facing)*(1-ss(1.80,1.822,z))*ss(1.575,1.595,z)*(1-ss(0.07,0.086,abs(x)))
for l in me.loops:
    v=me.vertices[l.vertex_index]; pu.data[l.index].uv=((U0+v.co.x/SX)/RW, 1-vpx(v.co.z)/RH)
ca=me.color_attributes.new('projw','FLOAT_COLOR','POINT')
for i,w in enumerate(W): w=float(w); ca.data[i].color=(w,w,w,1.0)
hd=me.color_attributes.new('headw','FLOAT_COLOR','POINT')   # head island (for cleaning the old side-of-head eye streaks)
for v in me.vertices:
    h=sum(g.weight for g in v.groups if g.group==hi); h=1.0 if (h>0.3 and v.co.z>1.6) else 0.0; hd.data[v.index].color=(h,h,h,1.0)
print('weighted verts',int((W>0.01).sum()))
# bake setup
sc=bpy.context.scene; sc.render.engine='CYCLES'; sc.cycles.device='CPU'; sc.cycles.samples=1
sc.render.bake.margin=8; sc.render.bake.use_clear=True
for o in bpy.context.view_layer.objects: o.select_set(False)
b.select_set(True); bpy.context.view_layer.objects.active=b
mat=bpy.data.materials.new('bakemat'); mat.use_nodes=True; nt=mat.node_tree; N=nt.nodes
for n in list(N): N.remove(n)
out=N.new('ShaderNodeOutputMaterial'); em=N.new('ShaderNodeEmission'); nt.links.new(em.outputs[0],out.inputs[0])
uvn=N.new('ShaderNodeUVMap'); uvn.uv_map='proj'
tex=N.new('ShaderNodeTexImage'); tex.extension='EXTEND'
attr=N.new('ShaderNodeAttribute'); attr.attribute_name='projw'
tgt=N.new('ShaderNodeTexImage')
nt.links.new(uvn.outputs[0],tex.inputs[0])
old=list(me.materials); me.materials.clear(); me.materials.append(mat)
def load(p):
    im=bpy.data.images.load(p); im.colorspace_settings.name='Non-Color'; return im
def bake(src_socket, res, name):
    im=bpy.data.images.new(name,res,res,alpha=False,float_buffer=True); im.colorspace_settings.name='Non-Color'
    tgt.image=im; N.active=tgt; tgt.select=True
    for l in list(em.inputs[0].links): nt.links.remove(l)
    nt.links.new(src_socket,em.inputs[0])
    bpy.ops.object.bake(type='EMIT')
    return np.array(im.pixels[:]).reshape(res,res,4)[...,:3]
tex.image=load(REF); P=bake(tex.outputs[0],2048,'P')
M2=bake(attr.outputs[0],2048,'M2')[...,:1]
tex.image=load(REFE); E=bake(tex.outputs[0],1024,'E')
M1=bake(attr.outputs[0],1024,'M1')[...,:1]
attr.attribute_name='headw'; HM2=bake(attr.outputs[0],2048,'HM2')[...,0]; HM1=bake(attr.outputs[0],1024,'HM1')[...,0]
me.materials.clear()
for m in old: me.materials.append(m)
def arr(p):
    im=load(p); r=im.size[0]; a=np.array(im.pixels[:]).reshape(r,r,4)[...,:3]; return a
T='/workspace/hero-game-assets/mixamo/tex/cent_'
A=arr(T+'albedo.png'); Em=arr(T+'emit.png'); Nm=arr(T+'normal.png')
# old painted eye glow + lens streak on the sides of the head (outside the projection): drop from emissive, inpaint in albedo
Em=Em*(1-(HM1>0.5)[...,None]*(M1<0.6))
bright=(A.min(2)>0.5)&(A[...,0]>A[...,2]+0.15)&(HM2>0.5)&(M2[...,0]<0.9)
k=np.ones(bright.shape,bool); k[:]=~bright
import scipy.ndimage as ndi
bright=ndi.binary_dilation(bright,iterations=3)&(HM2>0.5); k=~bright
F=A.copy(); F[bright]=0; Wt=k.astype(float)
for it in range(80):
    Fs=sum(np.roll(np.roll(F*Wt[...,None],dy,0),dx,1) for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)))
    Ws=sum(np.roll(np.roll(Wt,dy,0),dx,1) for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)))
    upd=bright&(Ws>0); F[upd]=Fs[upd]/Ws[upd][...,None]; Wt=np.where(upd,1.0,Wt)
A=np.where(bright[...,None],F,A)
print('streak px',int(bright.sum()))
An=A*(1-M2)+np.clip(P*1.1,0,1)*M2   # slight lift: the game's lighting reads darker than the art
En=Em*(1-M1)+E*M1
flat=np.array([0.5,0.5,1.0]); Nn=Nm*(1-0.9*M2)+flat*0.9*M2
def save(a,name):
    r=a.shape[0]; im=bpy.data.images.new(name,r,r,alpha=False); im.colorspace_settings.name='Non-Color'
    px=np.concatenate([np.clip(a,0,1),np.ones((r,r,1))],2).ravel(); im.pixels.foreach_set(px.astype(np.float32))
    p=f'{TEX}/{name}.png'; im.filepath_raw=p; im.file_format='PNG'; im.save(); return p
pa=save(An,'cent_albedo_face'); pe=save(En,'cent_emit_face'); pn=save(Nn,'cent_normal_face'); save(M2,'mask') if False else None
# point the real material at the new textures
m=bpy.data.materials['cent_mat']
for n in m.node_tree.nodes:
    if n.type=='TEX_IMAGE' and n.image:
        nm=n.image.name
        if 'albedo' in nm: n.image.filepath=pa; n.image.reload()
        elif 'emit' in nm: n.image.filepath=pe; n.image.reload()
        elif 'normal' in nm: n.image.filepath=pn; n.image.reload()
me.uv_layers.remove(me.uv_layers['proj']); me.color_attributes.remove(me.color_attributes['projw']); me.color_attributes.remove(me.color_attributes['headw'])
bpy.data.materials.remove(mat)
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('DONE')
