# Atomax BCD (block cable diagrams)

How Atomax-UK draws block cable diagrams (document type 71). Use with the Atomax CAD house rules.

## What a BCD shows
- Every cable between the panel / MCC / RIO and what it feeds, and nothing that is not a cable on the source (cable schedule, master device list, IO list).
- One BCD per panel / MCC / RIO unless the job says otherwise. Large ones run onto more sheets ("SHEET 1 OF 2"), a JB never split across sheets.
- Struck-through schedule rows are not drawn. Spare ways with no cable are left off and said in a note.

## Layout
- The panel / MCC as one long block across the drawing, its name inside, centred (e.g. "No.1 BUHLER MOTOR CONTROL CENTRE").
- Its outgoing cables drop straight down to the devices in a row below, in the order of the schedule. Each device directly under its cable.
- Incoming supplies and interface cables to other panels go up from the top of the panel block to a label: "SUPPLY FROM <board> (<ref>)" or "LINK TO <panel> SEE DWG <drawing number>". These interface cables are drawn but not checked as part of this panel.
- A junction box sits between the panel and its devices: panel → JB → devices, cables straight.
- Devices: motors as a circle with the motor tag inside; JBs, LCPs, E-stops and instruments as rectangles with the tag inside.
- Each device's description is written under it, centred, in capitals, exactly as the source gives it (e.g. WHEAT MILL NO.1 - MILL (WML01) FEED ROLL DRIVE MOTOR "BUHLER LCP").
- The area the equipment is in is a dashed boundary with the area name at its top left (e.g. "GIRVAN SOUTH GRAIN - WHEAT MILL").

## Cable text
- Cable number on the first line, cores and size on the second (e.g. E/WML01-MCC/P002 then 4C 2.5MM²), written up the cable beside the line.
- On instrument BCDs drawn in the house BCD template, the cable text sits in the yellow cable box on the cable: number, cores x size, type.
- Cores as written: 4C, 12C, 2PR, 10PR. Sizes as written with MM² (0.75MM², 1.5MM², 2.5MM²).

## National Grid / power BCDs
- On National Grid LVAC work the supply chain runs left to right (intake / RMU → joint → transformer → LV board → circuits; generator → distribution unit → interface box), every cable joined at both ends.
- Equipment as filled blocks: energised (existing) and de-energised / new; cables coloured: current supply cabling, new by BGEN (red), existing by others (dashed green). The key goes in the notes column under the notes.

## Notes and references
- Note 1: the source of the cable data (schedule reference and revision), and that unverified site information must be cross-checked on site.
- References: the other BCDs on the job and the cable schedule, by number and title.
- Revision triangles on changed cables / devices; P01, P02 ... in the revision box with ISSUED FOR COMMENT and the drawn / checked / approved initials.

## Title
- Four lines: BLOCK CABLE DIAGRAM / <plant or area> / <panel name> / SHEET n, e.g. BLOCK CABLE DIAGRAM / WHEAT PLANT / WHEAT No.1 BUHLER MCC / SHEET 1.
