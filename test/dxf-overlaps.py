import sys, ezdxf, re, itertools
UNI = lambda s: re.sub(r'\\U\+([0-9A-Fa-f]{4})', lambda m: chr(int(m.group(1), 16)), s)
from ezdxf import bbox
from ezdxf.math import BoundingBox2d
f=sys.argv[1]; d=ezdxf.readfile(f)
spaces=[d.modelspace()]+[l for l in d.layouts if l.name!='Model']
texts=[]; segs=[]
def walk(ents, depth=0):
    for e in ents:
        t=e.dxftype()
        if t=='INSERT':
            walk(list(e.virtual_entities()), depth+1)
        elif t in ('TEXT','MTEXT','ATTRIB'):
            txt=e.dxf.text if t!='MTEXT' else e.plain_text()
            if not txt.strip(): continue
            try:
                b=bbox.extents([e], fast=False)
                if b.has_data: texts.append((txt.replace('\n','|')[:40], b, e.dxf.layer))
            except Exception as ex: pass
        elif t=='LINE': segs.append(((e.dxf.start.x,e.dxf.start.y),(e.dxf.end.x,e.dxf.end.y),e.dxf.layer))
        elif t=='LWPOLYLINE':
            pts=[p[:2] for p in e.get_points()]
            if e.closed: pts.append(pts[0])
            for a,b2 in zip(pts,pts[1:]): segs.append((a,b2,e.dxf.layer))
        elif t=='CIRCLE':
            c=e.dxf.center; r=e.dxf.radius
            import math
            pts=[(c.x+r*math.cos(i/16*2*math.pi), c.y+r*math.sin(i/16*2*math.pi)) for i in range(17)]
            for a,b2 in zip(pts,pts[1:]): segs.append((a,b2,e.dxf.layer))
for e in d.entitydb.values():
    try:
        if e.dxftype() in ('TEXT', 'ATTRIB') and '\\U+' in e.dxf.text: e.dxf.text = UNI(e.dxf.text)
        elif e.dxftype() == 'MTEXT' and '\\U+' in e.text: e.text = UNI(e.text)
    except Exception: pass
for sp in spaces: walk(sp)
def shrink(b,m=0.25): return (b.extmin.x+m,b.extmin.y+m,b.extmax.x-m,b.extmax.y-m)
def ov(a,b): return a[0]<b[2] and b[0]<a[2] and a[1]<b[3] and b[1]<a[3]
def segbox(p,q,B):
    # Liang-Barsky clip
    x0,y0,x1,y1=B; dx=q[0]-p[0]; dy=q[1]-p[1]; t0,t1=0,1
    for pp,qq in ((-dx,p[0]-x0),(dx,x1-p[0]),(-dy,p[1]-y0),(dy,y1-p[1])):
        if pp==0:
            if qq<0: return False
        else:
            r=qq/pp
            if pp<0: t0=max(t0,r)
            else: t1=min(t1,r)
            if t0>t1: return False
    return True
T=[(n,shrink(b),l) for n,b,l in texts]
bad=0
for (a,A,la),(b,B,lb) in itertools.combinations(T,2):
    if ov(A,B): print('TEXT/TEXT', repr(a),'<>',repr(b)); bad+=1
for n,B,l in T:
    for p,q,ls in segs:
        if segbox(p,q,B): print('TEXT/LINE', repr(n), 'line on', ls[:30], tuple(round(v,1) for v in p), tuple(round(v,1) for v in q)); bad+=1; break
print(len(T),'texts',len(segs),'segments',bad,'problems')
