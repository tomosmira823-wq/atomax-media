import sys, ezdxf, re
UNI = lambda s: re.sub(r'\\U\+([0-9A-Fa-f]{4})', lambda m: chr(int(m.group(1), 16)), s)
from ezdxf import bbox
d=ezdxf.readfile(sys.argv[1]); boxes=[]; texts=[]
def walk(ents):
    for e in ents:
        t=e.dxftype()
        if t=='INSERT': walk(list(e.virtual_entities()))
        elif t=='LWPOLYLINE' and e.closed:
            pts=[p[:2] for p in e.get_points()]; xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
            if len(pts)==4: boxes.append(('box',min(xs),min(ys),max(xs),max(ys)))
        elif t=='CIRCLE': c=e.dxf.center; r=e.dxf.radius; boxes.append(('circle',c.x-r,c.y-r,c.x+r,c.y+r))
        elif t in('TEXT','MTEXT'):
            if e.dxf.layer.startswith('E-020') or 'Notes' in e.dxf.layer: continue
            b=bbox.extents([e],fast=False)
            if b.has_data: texts.append(((e.dxf.text if t=='TEXT' else e.plain_text())[:20], b.extmin.x,b.extmin.y,b.extmax.x,b.extmax.y))
for e in d.entitydb.values():
    try:
        if e.dxftype() in ('TEXT', 'ATTRIB') and '\\U+' in e.dxf.text: e.dxf.text = UNI(e.dxf.text)
        elif e.dxftype() == 'MTEXT' and '\\U+' in e.text: e.text = UNI(e.text)
    except Exception: pass
for sp in [d.modelspace()]: walk(sp)
worst=0; n=0
for kind,x0,y0,x1,y1 in boxes:
    inside=[t for t in texts if t[1]>=x0-0.01 and t[3]<=x1+0.01 and t[2]>=y0-0.01 and t[4]<=y1+0.01]
    if not inside or (x1-x0)>60: continue
    tx0=min(t[1] for t in inside); ty0=min(t[2] for t in inside); tx1=max(t[3] for t in inside); ty1=max(t[4] for t in inside)
    dx=((tx0+tx1)-(x0+x1))/2; dy=((ty0+ty1)-(y0+y1))/2; n+=1
    off=max(abs(dx),abs(dy)); worst=max(worst,off)
    if off>0.3: print(f'{kind} {[t[0] for t in inside][:3]} off by dx={dx:.2f} dy={dy:.2f}')
print(n,'boxes with text, worst offset',round(worst,2),'mm')
