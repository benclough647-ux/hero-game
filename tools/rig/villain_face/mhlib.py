# MakeHuman (CC0) base mesh + targets loader (numpy only; used inside and outside Blender)
import numpy as np, os
MH = '/workspace/mh/makehuman/makehuman/data'
def load_obj(path=f'{MH}/3dobjs/base.obj'):
    V, VT, F, FT, G = [], [], [], [], []; g = None
    for line in open(path):
        if line.startswith('v '): V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('vt '): VT.append([float(x) for x in line.split()[1:3]])
        elif line.startswith('g '): g = line.split()[1]
        elif line.startswith('f '):
            parts = [p.split('/') for p in line.split()[1:]]
            F.append([int(p[0]) - 1 for p in parts]); FT.append([int(p[1]) - 1 if len(p) > 1 and p[1] else -1 for p in parts]); G.append(g)
    return np.array(V), np.array(VT), F, FT, G
_tcache = {}
def target(name):
    if name in _tcache: return _tcache[name]
    p = f'{MH}/targets/{name}.target'; idx, d = [], []
    for line in open(p):
        if line[0] in '#\n': continue
        s = line.split(); idx.append(int(s[0])); d.append([float(x) for x in s[1:4]])
    r = (np.array(idx, int), np.array(d)); _tcache[name] = r; return r
def apply(V, name, w):
    if abs(w) < 1e-6: return V
    i, d = target(name); V = V.copy(); V[i] += d * w; return V
