---
name: "atomax-sld-dxf"
description: "Draw an Atomax-UK single line diagram (SLD) as DXF using Template_MCCB.dxf Layout2 blocks and the Atomax A1 frame; use when asked to create, redraw or convert an SLD/single line/HV-LV schematic to DXF/CAD."
---

# Atomax SLD → DXF

Produces one DXF per drawing:
- **Paper space** – A1 layout named after the drawing number containing the Atomax A1 border, grid, title block, logo, NOTES / LEGEND / REFERENCE DOCUMENTS panel, plus ONE locked 1:1 viewport inside the border.
- **Model space** – the single line diagram itself (and any circuit tables), drawn 1:1 in mm in sheet coordinates, built from the template's **Layout2 blocks**.


## Atomax house rules (kept with the app: what Tom's markups taught it, applied to every job)

- **Rooms**: every board and load sits in its room (switchroom, compound, enclosure, hall) from the cable schedule's From / To Location columns, each room a dashed box named top left. Items by others (DNO, ICP, "by others") sit outside the scope box.
- **Spares**: every spare way on the schedule is shown, struck through or not. The one exception is a client comment or revision saying a spare way is deleted / removed / no longer required: that way no longer exists and goes from every drawing.
- **The schedule is the source**: cable type (with voltage), cores, size, length and locations come from the cable schedule's own columns, whatever the engineer's draft said. A mistyped cable number (a letter I or O among the digits, e.g. C-0I4) is TBC on the drawing with a query in the RFI register, never copied.
- **Revisions**: compared with the previous revision; changed items and new feeders / cables get a revision cloud and triangle; the revision note names only what changed by cable number ("P02: ADDED C-018; REMOVED C-009; CHANGED C-013"). The client's own words never go on the drawing; a reissue / revision of an existing drawing is never a new drawing.
- **Notes**: no abbreviations key, no "PR - PAIR" style lists, no revision history retold in the notes, no "confirmed as / uprated to" notes; one revision note as above.
- **SLD scope**: power circuits only. Control and instrument cables (local control stations, transmitters, e-stops, pair cables) are not drawn on the SLD; they are on the BCD, with the note "Control and instrumentation cables are shown on the block cable diagram".
- **Incomers**: each source is its own incomer chain (transformer feed one, standby generator another), never one chain running through both. Boards fed side by side line up: same busbar level, outgoing cable tags in one row.
- **Spare way wording**: a breaker then `SPARE - EQUIPPED, OFF & LOCKED` with the rating where known.

## Atomax house rules (every drawing – these override anything below that disagrees)

- **Text height 2.0 minimum** for everything on the drawing: labels, cable text, circuit lists, notes, references, revision rows. Where a step below gives a smaller height, use 2.0 and make the box / pitch bigger to suit. Larger is fine for equipment names and headings.
- Multi-line text is MTEXT, never stacked single lines. Capitals, units written normally (mm², kW, kVA).
- **Nothing overlaps**: no text touching or crossing linework, cell lines or other text. Cables never overlap or cross each other: re-order before accepting a crossing. Runs are straight; a dog-leg only where two items cannot both be level.
- **Border by client**: Atomax jobs on the Atomax frame; BGEN jobs on the BGEN border; National Grid jobs on the National Grid sheet (from X11395-BGN-ZZ-XX-DR-E-7262: NG title box with NG and originator numbers, issue boxes along the bottom, no CDM box); other clients on their own title block when supplied. Use the **smallest sheet the drawing fits at 1:1** and **centre the drawing in the viewport**.
- **Numbers and revisions**: QS 006 (X + date - area - discipline - type - sequence). Revisions are always **two digits: P01, P02, A01, C01**. Revision history is cumulative, newest on top. Changed items get a revision triangle with the revision number; open items a HOLD cloud and a note.
- **Notes column**: NOTES, then the LEGEND (key) under the notes, then REFERENCE DOCUMENTS (drawing number - title). Note 1 says where the information came from and, if it is unverified site information, that it must be cross-checked on site.
- **The drawing goes to the client**: no questions, TQs / RFIs or "SEE TQ" in labels or notes (an unknown is just TBC; the question goes to the job's RFI register), no internal sources (master device list), no notes about how the workbook was read. Client name in full as their email signature writes it, including Ltd.
- **Only what is written**: tags, cable numbers, cores, sizes, ratings and terminals exactly as in the source. Never invent a tag; where the source gives only a description, use the description. Obvious typos in the source are flagged, not copied. Unknowns are TBC with a note.

## Inputs (check before starting)

| File | Required | Notes |
|---|---|---|
| `Template_MCCB.dxf` | yes – David uploads it each time | Source of all blocks, layers, linetypes, text styles. Output is built *on top of a copy of this file*. |
| `ATOMAX_A1_FRAME.dxf` | yes | Contains block `ATOMAX_A1_FRAME` (border, grid A–M / 1–16, title block lines + labels, logo hatches, NOTES/LEGEND/REFERENCE DOCUMENTS headings). If not uploaded, ask for it. Fallback only if unavailable: copy the paper-space frame from a previous Atomax SLD DXF, or extract vector linework from an Atomax PDF (see Step 3). |
| SLD source | yes | Any of: previous PDF/DWG/DXF SLD, marked-up sketch/photo, equipment/cable schedule, or a written description. |

Uploaded files are originals – copy into the working dir, never edit in place.

## Step 1 – Prompt for project details

Before building, send ONE message (SendUserMessage) listing these fields. Pre-fill anything you can read from the source drawing and ask David to confirm/correct; don't ask field-by-field.

```
CLIENT ............................ (e.g. NATIONAL GRID)
PROJECT line 1 / line 2 ........... (e.g. EAKRING TRAINING CENTRE / TRANSFORMER No.1 REPLACEMENT)
DRAWING TITLE line 1 / line 2 ..... (e.g. SINGLE LINE DIAGRAM / PROPOSED HV/LV ARRANGEMENT)
DRAWING NUMBER .................... (Atomax format X######-####-##-##-####)
REVISION .......................... (e.g. P01)
REVISION DATE ..................... (dd.mm.yyyy – default today)
REVISION DESCRIPTION (1–2 lines) .. (e.g. ISSUED FOR REVIEW - DETAILED / DESIGN (DRAFT FOR IFC))
DRN / CHKD / APP initials ......... (blank allowed)
DRAWN / CHECKED / APPROVED names .. (blank allowed)
DATE (title block) ................ (default = revision date)
SCALE ............................. (default NTS)
SHEET x OF y ...................... (default 1 OF 1)
NOTES ............................. (keep from source / supply / none)
REFERENCE DOCUMENTS ............... (keep from source / supply / none)
Anything to change vs the source (new/existing, ratings, tags)?
```

If David isn't around to answer, take the values from the source drawing, put `TBC` where unknown, and list what was assumed at the top of the final reply.

## Step 2 – Inspect the template (every time – anonymous block names can change)

```python
import ezdxf
from collections import defaultdict
d = ezdxf.readfile('in/template.dxf')
def orig(name):                       # resolve *Unnn dynamic-block representation -> source block name
    br = d.block_records.get(name)
    if br is not None and br.has_xdata('AcDbBlockRepBTag'):
        for code, val in br.get_xdata('AcDbBlockRepBTag'):
            if code == 1005:
                e = d.entitydb.get(val); return e.dxf.name if e else val
    return name
use = defaultdict(list)
for e in d.layouts.get('Layout2').query('INSERT'):
    use[orig(e.dxf.name)].append((e.dxf.name, e.dxf.layer, {a.dxf.tag: a.dxf.text for a in e.attribs}))
for k, v in use.items(): print(k, len(v), v[0])
```

Then render a catalogue of the blocks you'll use (insert each into a scratch copy of model space, `add_auto_attribs({})`, render with the ezdxf drawing addon) and LOOK at it to confirm each symbol and its visibility state before using it.

### Known Layout2 blocks (Template_MCCB, Oct 2026) – verify with Step 2

All switching blocks: insertion point = TOP terminal, symbol runs 25 mm downward (0 → −25). Attribute text sits to the left. Text height 2.0, style `BOULTING ARIAL`.

| Use for | Block | Attribute tags |
|---|---|---|
| MCCB / circuit breaker (outgoing ways, HV CB) | `MCCB` | COMPARTMENT, CPD_SIZE_RATING (setting e.g. `Ir 250A`), CPD_FRAME_SIZE (frame e.g. `250A`) |
| ACB / withdrawable incomer | `WITHDRAWABLE MCCB ISOLATING` | same as MCCB |
| MCB | `MCB` | COMPARTMENT, CPD_SIZE_RATING, CPD_FRAME_SIZE (`TYPE 'C'`) |
| Load-break / ring switch | `LOAD SWITCH` | COMPARTMENT, SWITCH_RATING, LINE_1 |
| Switch-disconnector / isolator / fuse-switch | `SWITCH DISCONNECTOR`, `ISOLATOR DISCONNECTOR`, `FUSED SWITCH DISCONNECTOR`, `SWITCH DISCONNECTOR FUSE` | COMPARTMENT, CPD_SIZE_RATING, CPD_FRAME_SIZE (+FUSE_*) |
| Fuse | `FUSE` | COMPARTMENT, FUSE_SIZE_RATING, FUSE_FRAME_SIZE |
| Contactor | `CONTACTOR1` / `CONTACTOR2` | – |
| HV/LV transformer | `HV-LV TRANSFORMER` – use the anonymous representation with the right vector group (Oct 2026: `*U277` = Dyn11 delta/star, `*U278` = star/star). Origin = top of HV winding, 30 mm tall | TX_NAME, MANUFACTURER_RATING, HV_VOLTS_LV_VOLTS, PRIMARY_AMPS, SECONDARY_AMPS, VECTOR_GROUP_COOLING, IMPEDANCE, DATE_MANUFACTURE, SERIAL_NUMBER |
| Generator | `SOURCE` (`*U263` = generator state) | DESIGNATION, RATING_MANUFACTURER, CONTINUOUS_POWER, PHASE_CURRENT, FUEL… |
| Busbar | `BUSBAR` (220 mm, polyline const width 1.0) | LINE_1–5 (left, stacked above bar), LINE_6–8 (right-aligned, above right end) |
| Multifunction meter + CT | `MULTIMETER` (`*U260`) – origin = CT on the conductor | METER, CT_RATING |
| CT + relay (ANSI) | `ANSI_1` (CT+relay), `ANSI_2` (relay only) | CT_RATING, ANSI_DEVICE_NUMBER |
| Ammeter / voltmeter | `AMMETER`, `VOLTMETER` | CT_RATING, AMMETER / FUSE_SIZE, TX_VOLTAGE, VOLTMETER |
| Mechanical interlock | `MECH INTERLOCK` (+ dashed line on interlocking layer) | – |
| Castell key | `KEY` | NORMAL_POS, KEY_LETTER |
| Motorised operator | `MOTORISED` | – |
| Downstream board | `PANEL LOAD` (20 mm bar, text below) | LOAD1–LOAD4 |
| Final load | `LOAD` (8×8 box), `MOTOR`, `PUMP` | LOAD (box text), PHASE, LOAD1–LOAD4 |
| Motor starters | `MOTOR STARTER DOL`, `SOFT STARTER`, `VSD`, … | LINE_1 |
| Board title | `BOARD DESCRIPTION` | DB_DESIGNATION, LOCATION_DESCRIPTION |

No template block exists for: cable joints, HV cable boxes, SPDs, MEB/NEL, earth symbols, GCP/connection boxes → draw as simple linework on the matching layer.

Base dynamic block names (e.g. `MCCB`) stay dynamic in AutoCAD; anonymous `*Unnn` refs display correctly but aren't dynamic – only use `*Unnn` when a non-default visibility state is needed, and tell David which ones.

### Layers / colour convention (template)

| Content | Layer |
|---|---|
| HV plant / text | `E-613___E-E-HV Switchgear and Power Systems Plant` / `E-613___T-E-HV Switchgear and Power Systems Plant Text` |
| LV plant / text | `E-618___E-E-LV Switchgear and Power Systems Plant` / `E-618___T-E-LV Switchgear and Power Systems Plant Text` |
| Transformer / text | `E-611___E-E-HV to LV Transformer` / `E-611___T-E-HV to LV Transformer Text` |
| New cables / cable text | `E-622___E-E-Wiring Cable Wiring Systems` (green) / `E-622___T-E-Wiring Cable Wiring Systems Text` |
| Existing cables | create `E-622___E-E-Wiring Cable Existing` (colour 8) |
| Equipment boundaries | create `E-600___E-E-Equipment Boundary` (colour 8, DASHED) |
| Interlocks | `E-613___E-E-HV Switchgear and Power Systems Interlocking` (DASHED, colour 30) |
| Meters | `E-614___E-E-Electrical Management System` |
| Earthing | `E-690___E-E-Earthing General` |
| General services / text | `E-600___E-E-Electrical Services` / `E-600___T-E-Electrical Services Text` |
| Notes, tables | `Z-903___T-E-Notes Text` |
| Frame / frame text | `E-020___E-E-Drawing Frame` / `E-020___T-E-Drawing Frame Text` |
| Viewport | `Z-020___O-E-Vport` |

Block internals are on fixed layers (equipment always red), so **new vs existing equipment cannot be shown by colour**: label existing items `(EXISTING)`, put existing cables on the grey existing-cable layer, and make the LEGEND say exactly that (NEW CABLE green / EXISTING CABLE grey / EQUIPMENT BOUNDARY dashed / equipment note). Never leave a legend that claims a colour scheme the drawing doesn't use.

## Step 3 – Read the source

**PDF:** text is often outlined glyphs (no extractable text). Then:
1. `pymupdf` `page.get_drawings()` → exact geometry in mm: `x_mm = pt*25.4/72`, `y_mm = 594 - pt*25.4/72` (A1). Use these for busbar heights, feeder pitch, box extents – keep the source layout coordinates.
2. Cluster fill paths (`type 'f'`) into text runs (same colour, same baseline, small gap) → positions/heights; OCR each run with tesseract (`--psm 7`, crop at high zoom, rotate vertical runs).
3. Verify by reading high-res crops yourself (`get_pixmap(clip=…)`, rotate vertical text) – OCR mangles superscripts, `Q0`, rotated text. Never guess a value.

**Sketch / schedule / description:** lay out on a grid – incomer column(s) on the left, main busbar horizontal, outgoing ways at a constant pitch (≈36 mm works on A1), cables down to loads, notes/tables lower right inside the diagram area.

## Step 4 – Build (Python + ezdxf)

Install if missing: `pip install --break-system-packages ezdxf pymupdf matplotlib pillow pytesseract`.

```python
import ezdxf, math
from ezdxf.enums import TextEntityAlignment as TA
from ezdxf.addons import Importer
from PIL import ImageFont

doc = ezdxf.readfile('in/template.dxf')            # keep ALL template blocks/layers/styles
DWG = '<DRAWING NUMBER>'
lay = doc.layouts.new(DWG)
lay.page_setup(size=(841, 594), margins=(0, 0, 0, 0), units='mm', scale=(1, 1))   # scale MUST be (1,1)
for n in [l for l in doc.layouts.names() if l not in ('Model', DWG)]:
    doc.layouts.delete(n)
msp = doc.modelspace()
for e in list(msp): msp.delete_entity(e)            # template symbol palette; blocks remain in block table

# extra layers
for name, col, lt in [('E-622___E-E-Wiring Cable Existing', 8, 'Continuous'),
                      ('E-600___E-E-Equipment Boundary', 8, 'DASHED')]:
    if name not in doc.layers: doc.layers.add(name, color=col, linetype=lt)
if 'ATOMAX FRAME' not in doc.styles:
    doc.styles.add('ATOMAX FRAME', font='arial.ttf').dxf.width = 0.85
STY, FSTY = 'BOULTING ARIAL', 'ATOMAX FRAME'

# --- frame block from ATOMAX_A1_FRAME.dxf into paper space at (0,0)
fdoc = ezdxf.readfile('in/ATOMAX_A1_FRAME.dxf')
imp = Importer(fdoc, doc); imp.import_block('ATOMAX_A1_FRAME'); imp.finalize()
lay.add_blockref('ATOMAX_A1_FRAME', (0, 0), dxfattribs={'layer': 'E-020___E-E-Drawing Frame'})

def text(space, s, x, y, h=2.0, layer='E-600___T-E-Electrical Services Text', rot=0, style=STY, align=None):
    t = space.add_text(s, dxfattribs=dict(layer=layer, height=h, style=style, rotation=rot))
    t.set_placement((x, y), align=align) if align else setattr(t.dxf, 'insert', (x, y))
    return t

def block(space, name, x, y, layer, attrs=None, rot=0):
    b = space.add_blockref(name, (x, y), dxfattribs=dict(layer=layer, rotation=rot))
    tags = {a.dxf.tag for a in doc.blocks.get(name) if a.dxftype() == 'ATTDEF'}
    if tags: b.add_auto_attribs({k: v for k, v in (attrs or {}).items() if k in tags})
    return b

# Arial width measurement (Liberation Sans is metric-compatible). DXF TTF height = cap height (Arial cap = 0.716 em)
_F = ImageFont.truetype('/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', 1000)
def adv_mm(s, h): return _F.getlength(s) / 1000 * h / 0.716

def cell_text(s, xl, xr, y, h=2.0, pad=1.0, layer='E-020___T-E-Drawing Frame Text'):
    """Centre text in a title-block cell and shrink width factor so it can never overlap the next cell."""
    t = text(lay, s, (xl + xr) / 2, y, h, layer, style=FSTY, align=TA.MIDDLE_CENTER)
    t.dxf.width = round(min(0.85, (xr - xl - 2 * pad) / adv_mm(s, h)), 3)
    return t

def left_text(s, x, y, h, xmax, layer='E-020___T-E-Drawing Frame Text'):
    """Left-aligned title text, width factor capped so it stays left of xmax."""
    t = text(lay, s, x, y, h, layer, style=FSTY)
    t.dxf.width = round(min(0.85, (xmax - x - 0.8) / adv_mm(s, h)), 3)
    return t
```

### Title block field positions (paper space, mm) – use cell_text/left_text, never plain text

Cell lines in ATOMAX_A1_FRAME (verified): rev row y 131.2–139.2 with dividers at x 736.2 / 744.2 / 756.2 / 796.2 / 804.2 / 812.2 / 820.2; DRAWN row 36.2–43.2, CHECKED row 29.2–36.2 (split at x 778.2; DATE/SCALE split at 803.2); SHEET row 25.2–29.2 from x 778.2; drawing-number band 15.2–25.2 with REVISION cell 808.2–820.2.

| Field | How |
|---|---|
| Rev row (bottom row, centre y 135.2) | `cell_text(REV, 736.3, 744.2, 135.2)`, `cell_text(DATE, 744.2, 756.2, 135.2)`, description 2 lines `cell_text(L1, 756.2, 796.2, 137.1, 2.0)` / `cell_text(L2, 756.2, 796.2, 133.3, 2.0)`; DRN / CHKD / APP: `cell_text(x, 796.2, 804.2, 135.2)`, `cell_text(x, 804.2, 812.2, 135.2)`, `cell_text(x, 812.2, 820.2, 135.2)` |
| Further revisions | add rows ABOVE (each 8 mm: 139.2–147.2, 147.2–155.2 …) by drawing the row's top line + the cell dividers (x 744.2, 756.2, 796.2, 804.2, 812.2) on `E-020___E-E-Drawing Frame`. First issue sits in the bottom row, each later revision goes in the next row up |
| CLIENT | `left_text(v, 741.4, 91.9, 2.0, 819)` |
| PROJECT lines | `left_text(v1, 741.4, 76.9, 2.0, 819)`, `left_text(v2, 741.4, 71.9, 2.0, 819)` |
| DRAWING TITLE lines | `left_text(v1, 741.4, 60.9, 2.0, 819)`, `left_text(v2, 741.4, 55.9, 2.0, 819)` |
| DRAWN / CHECKED names | `left_text(v, 741.4, 36.9, 2.0, 778)` / `left_text(v, 741.4, 29.9, 2.0, 778)` |
| APPROVED name | `left_text(v, 783.4, 29.9, 2.0, 819)` |
| DATE | `left_text(v, 786.3, 36.9, 2.0, 803)` |
| SCALE | `left_text(v, 813.4, 36.9, 2.0, 819.5)` |
| SHEET x OF y | `text(lay, x, 797.7, 26.0, 2.0, 'E-020___T-E-Drawing Frame Text', style=FSTY)`, same for y at x 807.7 (the word OF is in the frame) |
| DRAWING NUMBER | `left_text(v, 748.5, 17.2, 4.0, 807.5)` |
| REVISION (big) | `cell_text(rev, 808.2, 820.2, 18.4, 4.4)` |

Right-hand panel (paper space, layer `Z-903___T-E-Notes Text`, style ATOMAX FRAME, h 2.0, explicit line breaks ≤ ~50 characters, 3.33 mm line pitch):
- NOTES: heading is in the frame; numbers at x 738.4, text at x 744.3, first baseline 568.5, ≈1 line gap between notes; must finish above y 408.
- LEGEND: heading is in the frame at y 404.3; sample lines x 738.2–751.0 at label y+1.0 on the layer they represent, labels at x 756.4, first label baseline 399.7, pitch ≈4.7.
- REFERENCE DOCUMENTS: heading in the frame at 216.3; entries at x 738.3 from y 211.7 down, h 2.0, pitch ≈3.4; must stay above y 141.

### Diagram (model space)

House SLD conventions (from X11481-02-WHT-06-70-0001 and the Ameresco LV SWBD SLD):
- Incomer at the top (supply / transformer → incomer device with rating and frame → metering / CTs), busbar horizontal, outgoing ways dropping from it at a constant pitch with the way number and rating above each device (e.g. `Q05.2 20A`, `COMPT 01 160AT TPN`).
- Each way top to bottom: protective device → starter / drive box where there is one (`VARIABLE SPEED DRIVE`, `DOL STARTER`, `ELECTRONIC SOFT START`, `SAFE TORQUE OFF`, `SHUTDOWN RELAY`) → local isolator with its tag → load. Motors as a circle with `3PHASE MOTOR` and the kW.
- Outgoing cables carry their text up the cable: cable number, then size and type (e.g. `E/WH1&2-MCC/P001 4MM² XLPE/SWA/PVC LSZH COPPER 4CORE CABLE`); control cables to the same load run alongside, dashed, with their own text. On client drawings that use them, cable tag boxes on the conductor with the text up the box.
- Load description written up the page under the load with its plant tag in brackets.
- `(OPEN)` / `(CLOSED)` on switching devices only where the drawing shows a switching arrangement.
- New green / removal red **only on phase drawings** (one sheet per phase, each with its own colours); any other SLD is black.
- Switchroom / kiosk / enclosure as one dashed box named at its top left, round everything in that place per the equipment list: the main board AND every board and item it feeds in the same room (MCC, DBs, UPS, PFC, MET). What feeds it from another place (DNO RMU, transformer compound, generator enclosure) sits outside, its cable crossing the top wall; cables to other places (pump hall, wet well) leave through one bottom wall. A feeder between two things in the room (DB-03 to the MCC-01 PLC section) stays wholly inside. The wall never runs through text or symbols.
- Earthing: earth conductors hang off the board's own EARTH BAR (a separate bar under the busbar), never off the phase busbar (TN-S, separate PE throughout).
- Prospective fault current written `PROSPECTIVE FAULT 31.5kA` (PFC is power factor correction); 50Hz, kV, kVA written normally. Cable type and voltage exactly as the schedule (`XLPE/SWA/PVC 11kV, 6.35/11kV`).
- Every cable on the schedule between items on the drawing is drawn as a cable with its label, including earthing and neutral-earth conductors (e.g. transformer star point to the main earth bar, MEB to MET). Never a cable only in a note.
- No abbreviations note: Atomax drawings do not carry one (the app removes any that is written).
- LEGEND of symbols and protection functions used (50, 51, 51N, 27 …); HOLDS listed separately when there are open items.


- Draw in **model space**, 1:1 mm, in sheet coordinates. Usable area: x 22–734, y 17–577 (title column starts at 735).
- Switching blocks: insert at the top terminal; busbar → MCCB top = busbar y; cable continues from y − 25.
- Busbar: `BUSBAR` block for the labels + LWPOLYLINE const_width 1.0 on the LV layer to extend to full length.
- Leave a gap in conductors where long titles cross them.
- Cable labels: rotated 90° at x + 4 from the cable, text h 2.0 (e.g. `4c 300mm² Cu XLPE/SWA/LSZH` – write the ² character directly).
- Destinations: `PANEL LOAD` for downstream boards (LOAD1 tag, LOAD2/3 name, `(EXISTING)` where applicable); `LOAD` for final loads; spare ways: short stub + rotated `SPARE - EQUIPPED, OFF & LOCKED`. Every spare way on the schedule is shown, even when its row is struck through or a note says ignore it; never write a note saying a spare is not shown.
- Keep all engineering text from the source; don't invent ratings, tags or settings – use `TBC`. Fix obvious source truncations only if the complete value is elsewhere on the drawing, and report it.

### Viewport + finish

```python
for v in list(lay.query('VIEWPORT')):
    if v.dxf.id != 1: lay.delete_entity(v)
vp = lay.add_viewport(center=(378, 297), size=(712, 560), view_center_point=(378, 297), view_height=560)  # 1:1, inside border
vp.dxf.layer = 'Z-020___O-E-Vport'
vp.dxf.flags |= 16384                      # display locked
msp.reset_extents((22, 17, 0), (734, 577, 0))
doc.set_modelspace_vport(height=580, center=(378, 297))
doc.header['$INSUNITS'] = 4
doc.header['$TILEMODE'] = 0
doc.layouts.set_active_layout(DWG)
doc.saveas(f'out/{DWG}-{REV}.dxf')
```

## Step 5 – Verify (mandatory before sending)

1. Reopen with ezdxf: `audit().has_errors` is False; model space has the diagram; paper space has the frame insert + title texts + 2 viewports (id 1 main + the 1:1 one); the 1:1 viewport `view_height == height`.
2. Render BOTH the layout and Model (ezdxf drawing addon + matplotlib; call `fig.set_size_inches(33.1, 23.4)` AFTER drawing or the image comes out tiny) and look at them:
   - title block: zoom crop of the rev row and drawing number – no text crossing cell lines;
   - symbols, attributes and labels not colliding;
   - every source item present (compare side by side with the source).
   The preview substitutes a wider font than Arial, so if it fits in the preview it fits in AutoCAD.
3. Check every value against the source / David's details (tags, ratings, cable sizes, notes).

## Step 6 – Deliver

SendUserFile the DXF (display `attach`). Reply briefly: what's in paper vs model space, which template blocks were used (and any static `*Unnn` ones), anything drawn as plain linework because no block exists, assumptions/TBCs, and any deviations from the source.

## Lessons learned (don't repeat)

- Empty model space with everything in paper space opened as a blank drawing – the diagram goes in model space, frame in paper space.
- `page_setup(scale=1)` produced a nonsense viewport (~1,000,000 mm) – always `scale=(1, 1)`.
- Left-aligned title-block texts overflowed (the rev-row date ran into DESCRIPTION) – always centre/cap width with `cell_text` / `left_text`.
- When adding paper-space text late in the script, make sure you're writing to `lay`, not `msp`.
- The ezdxf preview sometimes shows one logo diamond filled when the logo is inside a block – that's the previewer, not the file (logo hatch geometry verified with even-odd fill).