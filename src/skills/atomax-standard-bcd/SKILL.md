---
name: "atomax-standard-bcd"
description: "Draw an Atomax standard Block Cable Diagram (BCD) as DXF from TEMPLATE - BCD.dxf - diagram in model space, the project's border in the layout. Not for National Grid energisation BCDs."
---

# Atomax Standard BCD → DXF

The skill file had lost its body (it only held a placeholder line), so this is the standard BCD written out again from the Atomax BCDs (X11481-01-WHT-06-71-0004 Wheat Plant No.1 Buhler MCC BCD and the TEMPLATE - BCD.dxf house style). National Grid energisation / switching BCDs use `atomax-national-grid-bcd` instead.

One DXF per drawing:
- **Model space** – the BCD, 1:1 mm in sheet coordinates.
- **Paper space** – one layout per sheet, named after the drawing number, with the project's border, filled title block, NOTES / LEGEND / REFERENCES, and ONE locked 1:1 viewport onto the model.

Work as a senior E&I design engineer: the BCD is what site installs and what the cable schedule is checked against, so every cable must trace to the source and nothing is guessed.

## Atomax house rules (kept with the app: what Tom's markups taught it, applied to every job)

- **Rooms**: every board and load sits in its room (switchroom, compound, enclosure, hall) from the cable schedule's From / To Location columns, each room a dashed box named top left. Items by others (DNO, ICP, "by others") sit outside the scope box.
- **Spares**: every spare way on the schedule is shown, struck through or not. The one exception is a client comment or revision saying a spare way is deleted / removed / no longer required: that way no longer exists and goes from every drawing.
- **The schedule is the source**: cable type (with voltage), cores, size, length and locations come from the cable schedule's own columns, whatever the engineer's draft said. A mistyped cable number (a letter I or O among the digits, e.g. C-0I4) is TBC on the drawing with a query in the RFI register, never copied.
- **Revisions**: compared with the previous revision; changed items and new feeders / cables get a revision cloud and triangle; the revision note names only what changed by cable number ("P02: ADDED C-018; REMOVED C-009; CHANGED C-013"). The client's own words never go on the drawing; a reissue / revision of an existing drawing is never a new drawing.
- **Notes**: no abbreviations key, no "PR - PAIR" style lists, no revision history retold in the notes, no "confirmed as / uprated to" notes; one revision note as above.
- **One sheet**: the whole BCD on one sheet (A0 at most), the main switchboard across the top, everything hanging off it; columns close up before a sheet ever splits. A junction box with its instruments hung off it is still a power BCD (the panel layout), not an instrument-style drawing.
- **Cables between branches**: drawn once; the far end is a short pointer "TO MET (SHOWN UNDER MSB-01)". A transformer star point earth or generator earth is drawn from its item with that pointer.
- **Spare way with no cable**: labelled `SPARE WAY - NO CABLE`, to its own box SPARE-1, SPARE-2 ... with the rating.

## Atomax house rules (every drawing – these override anything below that disagrees)

- **Text height 2.0 minimum** for everything on the drawing. Larger is fine for the panel name and headings.
- Multi-line text is MTEXT, never stacked single lines. Capitals, units written normally (mm²).
- **Nothing overlaps**: no text touching or crossing linework or other text. Cables never overlap or cross each other: re-order the devices before accepting a crossing. Runs are straight.
- **Border by client**: Atomax jobs on the Atomax frame; BGEN jobs on the BGEN border (the joint BGEN / Atomax title block on BGEN jobs); National Grid jobs on the National Grid sheet; other clients on their own title block when supplied. **Smallest sheet the drawing fits at 1:1**, drawing **centred in the viewport**.
- **Numbers and revisions**: QS 006, type 71 (e.g. X11481-01-WHT-06-71-0004). Revisions always two digits (P01, P02 …), cumulative, newest on top, each with its description (e.g. ISSUED FOR COMMENT), date, drawing / Drg No reference and Dr'n / Chk'd / Ap'd initials. Changed cables / devices get a revision triangle with the revision number; open items a HOLD cloud and a note.
- **The drawing goes to the client**: nothing on it may show our own working. No questions, TQs / RFIs, "confirm" items, internal sources (master device list, Dex, the app, device / cable counts) or reasons why something was drawn a certain way. Every open question goes to the job's RFI register instead.
- **The schedule is the source**: each cable's type (with its voltage, e.g. `XLPE/SWA/PVC 11kV, 6.35/11kV`), cores, size and length, and each item's location, are copied from the schedule's own columns, never retyped. Vector groups keep their case (`Dyn11`, not `DYN11`).
- **Only what is written**: cable numbers, cores, sizes and tags exactly as on the cable schedule / master device list / IO list. Never invent a tag; a device with no tag is named by its description. Obvious typos flagged, not copied. Unknowns TBC with a note.

## Inputs (check before starting)

| Input | Required | Notes |
|---|---|---|
| Cable data | yes | Cable schedule, approved master device list or IO list. Struck-through rows are not drawn. |
| Device descriptions | yes | From the same source / instrument index (exact wording). |
| Locations | if given | Equipment list / schedule location column (e.g. HV Room, Pump Hall, Wet Well), exact wording. Each location becomes an area box. |
| Scope | yes | The email / schedule remarks: anything by others (DNO / ICP, client, vendor) is drawn outside the scope boundary. |
| Related drawings | if any | Other BCDs on the job (for LINK TO … SEE DWG labels) and the cable schedule number (for note 1 and REFERENCES). |
| Border | yes | Per the house rules above. DXF only (ask for a DXF export of a DWG/DWT). |

Install if missing: `pip install --break-system-packages ezdxf matplotlib pillow pymupdf openpyxl`.

## Step 1 – Project details (one message)

Send ONE message, pre-filled from the source:

```
CLIENT ........................ (e.g. WILLIAM GRANT & SONS LTD.)
PROJECT ....................... (e.g. GIRVAN SOUTH WHEAT PLANT)
DRAWING TITLE (4 lines) ....... BLOCK CABLE DIAGRAM / <plant> / <panel> / SHEET n
DRAWING NUMBER ................ (QS 006 type 71; next free number from the register if none)
REVISION / DATE / DESCRIPTION . (e.g. P01 / today / ISSUED FOR COMMENT)
DRN / CHKD / APP .............. (blank allowed – TBC)
SHEET SIZE .................... (smallest that fits at 1:1)
CABLE SOURCE .................. (schedule reference and revision – goes in note 1)
```

If David isn't there to answer, take the values from the source, put TBC, and list every assumption at the top of the reply.

## Step 2 – What goes on the drawing

- Every cable on the source, and nothing else, **on ONE sheet**: the main board at the top, what feeds it above, everything it feeds below, each board's own devices under that board (the smallest sheet it fits at 1:1, A0 if need be). Split one sheet per panel only when it will not fit even on A0.
- Each cable and each device is drawn once. A cable to something already shown in another branch (e.g. DB-03 to FT-01, which hangs under MCC-01) ends at a short label: `TO FT-01 OUTLET FLOW METER (SHOWN UNDER MCC-01)`.
- A board feeding several things is a long box spanning everything under it, never a motor circle (a 'motor control centre' is a board).
- Spare ways with no cable: left off, said in a note.
- Interface cables to panels on other drawings are drawn to a label (`LINK TO <panel> SEE DWG <number>`).
- Only when split per panel: a cable on two sheets is labelled in full on one only, the other gives its number and `SEE SHEET n`; a JB is never split across sheets.
- Units written normally even in capitals: 11kV, 1000kVA, 75kW, 200kVAr, 50kA 1s, 95mm², lengths in m.
- An area box steps down (or up) round a board in the same place rather than leaving it in a second box of the same name, so a cable never looks like it leaves the room when it does not.

## Step 3 – Layout

**MCC / panel BCD (X11481-01-WHT-06-71-0004 style):**
- The panel as one long rectangle across the top half of the drawing area, its name centred inside (e.g. `No.1 BUHLER MOTOR CONTROL CENTRE`).
- Outgoing cables drop straight down from the panel's bottom edge to the devices in one row below, in schedule order, each device directly under its cable. Two cables to one device (power + control) land side by side on it.
- Incoming supply and interface cables rise straight up from the panel's top edge to their label: `SUPPLY FROM <board> (<ref>)`, `LINK TO <panel> SEE DWG <number>`.
- Devices: motors as a circle (≈ 25 mm dia) with the tag inside; JBs, LCPs, E-stops, instruments as rectangles with the tag inside. A JB sits between the panel and its devices (panel → JB → devices), cables straight.
- Each device's description centred under it in capitals, exactly as the source gives it (e.g. `WHEAT MILL NO.1 - MILL (WML01) FEED ROLL DRIVE MOTOR "BUHLER LCP"`).
- **Areas**: when the documents give locations, each location is its own dashed box with its name at the top left (e.g. `PUMP HALL`, `WET WELL`, `VALVE CHAMBER`). Devices in the same location sit side by side so each location is one box; a device fed through another in the same place (isolator then motor) is inside the same box. The name sits clear of every cable and word; widen the box rather than letting the name touch anything.
- **Scope boundary**: a dashed box round everything in our scope, the site name at its top left (e.g. `HOLLINS LANE PUMPING STATION`). Equipment and cables by others (e.g. DNO RMU and its HV cable) are drawn outside it, shown for information. With no locations given, this one boundary is the area box.
- Cable text written up the cable (rotated 90°), centred on the line: the cable number just left of the line, cores and size just right of it, then type and length on the next line out (`C-012` / `4C 50MM²` / `XLPE/SWA/LSZH EMC - 55M`). Cores as `4C`, pairs as `2PR` (never `2P`). Length exactly as the schedule (in metres); when the schedule gives no lengths, leave the length off. The text sits in the middle of the clear part of the run, never crossing an area or scope box edge, and clear of the panel, the devices and the next cable. Each level's drop is long enough for the longest cable text on that level (not the whole drawing), so the drawing stays on the smallest sheet; a type line that is very long splits over two lines. The title block and LINK TO / SUPPLY FROM labels use the panel's short name (`MSB-01 MAIN LV SWITCHBOARD`); the ratings stay in the panel box.
- Device pitch so no two cable texts touch (≈ 25 mm between cables of one device, ≈ 60 mm between devices on A1).

**Instrument / RIO BCD (house template style):**
- Panels / RIOs on the left, JBs in the middle, field devices on the right; one row per cable, blocks as tall as their group so every run is straight.
- Each cable carries a yellow cable box on the line with the cable number, cores x size and type; the line stops at the box edges so it never runs through the text.

## Step 4 – Border, title block and notes

- Border and title block per the house rules; fill every field (CLIENT, PROJECT, DRAWING TITLE 4 lines, DRAWN / CHECKED / APPROVED, DATE, SHEET SIZE, SCALE N.T.S, STATUS, SHEET x OF y, DRAWING NUMBER, REVISION). Centre or cap text so nothing crosses a cell line.
- Status stamp where the border has one (e.g. `Review & Comment` on BGEN jobs for P revisions).
- NOTES (heading centred, numbered, capitals):
  1. `DRAWING DERIVED FROM SITE PROVIDED CABLE SCHEDULE "<ref>", HENCE DRAWINGS MAY NOT BE ACCURATE AS INFORMATION PROVIDED HAS NOT BEEN VERIFIED, AS SUCH THIS DRAWING SHOULD BE CROSS-CHECKED ON SITE BEFORE USE.` (when the source is unverified site information)
  2. `ALL CABLES TO BE INSTALLED IN ACCORDANCE WITH BS 7671:2018 (AS AMENDED) REQUIREMENTS FOR ELECTRICAL INSTALLATIONS (IET WIRING REGULATIONS 18TH EDITION).`
  3. `CABLES INSTALLED IN HAZARDOUS AREAS SHALL COMPLY WITH BS EN 60079-14.`
  4. `ALL SIGNAL/INSTRUMENTATION CABLES SHALL BE SEGREGATED FROM POWER CABLES AND INSTALLED IN ACCORDANCE WITH BS 7671 REGULATION 528.1 (BAND I AND BAND II SEPARATION).`
  5. `ALL CABLE CONTAINMENT, SUPPORTS AND FIXINGS TO BE INSTALLED IN ACCORDANCE WITH MANUFACTURER'S RECOMMENDATIONS AND BS 7671 SECTION 522.`
  6. `VENDOR SUPPLIED CABLES AND CONNECTIONS TO BE VERIFIED AGAINST VENDOR DOCUMENTATION PRIOR TO INSTALLATION.`
  7. `ALL CABLE TERMINATIONS WITHIN JUNCTION BOXES TO BE MADE USING APPROVED TERMINAL BLOCKS. TERMINALS TO BE IDENTIFIED IN ACCORDANCE WITH BS EN 60445.`
  8. `CABLE IDENTIFICATION LABELS TO BE FITTED AT BOTH ENDS OF EACH CABLE AND AT EVERY DRAW-IN POINT IN ACCORDANCE WITH BS 7671 REGULATION 514.`
  9. `ALL JUNCTION BOXES, LOCAL CONTROL PANELS AND INSTRUMENTS INSTALLED IN ATEX AREAS TO BE CERTIFIED EX SUITABLE FOR THE CLASSIFIED AREA.`
  10. `ALL CABLES TO BE GLANDED AND EARTHED AT BOTH ENDS UNLESS OTHERWISE INDICATED. EARTH CONTINUITY TO BE VERIFIED AND RECORDED.`
  Notes 3 and 9 only where the site has hazardous / ATEX areas.
  Then short client notes from the source: scope and by-others items (e.g. `C-001 AND RMU-01 ARE BY THE DNO / ICP AND ARE SHOWN FOR INFORMATION ONLY.`), what lengths are based on, parallel runs shown individually, screen earthing. A hold is stated as a fact (`SIZE OF C-030 ON HOLD.`), never as a question.
  **Never in the notes**: questions, anything to confirm or check, TQ / RFI items, how something was worked out (`NO TAGS ARE GIVEN SO THEY ARE SHOWN…`), the master device list or device / cable counts, a note that title block fields are TBC. Those go to the RFI register.
- **No abbreviations note**: Atomax drawings do not carry one (the app removes any that is written).
- **Every note must fit the notes column**: if it does not fit on the smallest sheet, go up a sheet size. Never let notes run off the column or be cut.
- LEGEND under the notes when symbols or colours need a key.
- REFERENCES: `<drawing number> - <title>`, one short line each (the other BCDs on the job, the cable schedule, the SLD). Client / project documents only, never the master device list or other internal lists.

## Step 5 – Verify (mandatory before sending)

1. Reopen with ezdxf: `audit().has_errors` is False; model space has the diagram; the layout has the border + one 1:1 viewport.
2. Render the layout (white background, full size) and look at it plus zoomed crops of the panel, every cable label, the devices and the title block: no text touching lines or other text, no cables crossing, drawing centred.
3. Check against the client's email: every ask on it is on the drawing (e.g. type and length on every cable, grouping by location, items left outside the scope box).
4. Read every note as the client would: nothing internal, no questions, nothing TBC that is filled in.
5. Spares: every spare on the schedule (spare cable or spare way with a cable number) is drawn like any other cable to its own box (SPARE-1, SPARE-2 ..., label SPARE WAY + rating), even if struck through or a note says ignore it. Never write a note saying a spare is not shown.
6. Count cables on the drawing against the source both ways: every source cable drawn, nothing drawn that is not on the source. Check every number, core count and size character by character.

## Step 6 – Deliver

SendUserFile the DXF (and PDF if asked). If a project folder is connected, save to the BCD section under the document number. Reply briefly: border used and why, sheets, the both-ways cable count, and the questions added to the RFI register.
