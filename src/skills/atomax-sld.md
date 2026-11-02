# Atomax SLD (single line diagrams)

How Atomax-UK draws single line diagrams (document type 70). Use with the Atomax CAD house rules.

## What an SLD shows
- The supply, the board(s) and every outgoing way, with protective devices, ratings, cables and loads as written in the load schedule / protection settings / cable schedule.
- Boards that are fed from another board are drawn under it, joined by the feeder, so the whole system is one connected diagram.

## Board and ways
- Incomer at the top: supply / transformer, incomer device with rating and frame (e.g. MCCB 250A / 160A), metering / CTs where shown.
- Busbar horizontal; each way drops from it with its way number and rating above the device (e.g. Q05.2 20A, COMPT 01 160AT TPN).
- For each way, top to bottom: protective device (MCCB / MCB / fuse switch / ACB with its rating), then starter or drive as a box where there is one (VARIABLE SPEED DRIVE, DOL STARTER, ELECTRONIC SOFT START, SAFE TORQUE OFF, SHUTDOWN RELAY), then the local isolator with its tag, then the load.
- Motors as a circle with "3PHASE MOTOR" and the kW; distribution boards as a box with their name and reference drawing.
- Spare and space ways shown as SPARE / SPACE with their rating.

## Cables
- Each outgoing cable as a cable tag on the conductor, text written up the cable: cable number, then size and type, e.g. E/WH1&2-MCC/P001  4MM²  XLPE/SWA/PVC LSZH COPPER 4CORE CABLE.
- Control cables to the same load drawn alongside, dashed, with their own tag.
- Unknown sizes TBC with a note.

## Loads
- The load description written up the page under the load, in capitals, with its plant tag in brackets, e.g. WHEAT MILLING №1 & №2 MCC RECEIVING HOPPER HIGH PRESSURE LARGE FILTER FAN VARIABLE SPEED DRIVE (GVN-GWS-SMIL-FIL02-F01).

## States and stages
- Switching states (OPEN) / (CLOSED) where the drawing shows a switching arrangement.
- On phase drawings only: new items green, items for removal red, existing black; each phase is its own sheet with its own colours. Any other SLD is all black.
- A switchroom / kiosk / enclosure as a dashed box with its name above.

## Notes, legend, holds
- Notes: equipment standards that apply (e.g. switchgear to IEC 61439-1, MCCBs with electronic LSI protection unless noted), fault level indicative only and to be confirmed by the manufacturer, cable details to be confirmed by the installer, interlocks and protection settings by the manufacturer.
- LEGEND of the symbols and protection function numbers used (50, 51, 51N, 27 ...).
- HOLDS listed separately when there are open items (magenta on client drawings that use them).
- References: other SLDs, DB schedules and the load schedule by number and title.

## Title
- SINGLE LINE DIAGRAM / <plant or site> / <board name> / SHEET n.
