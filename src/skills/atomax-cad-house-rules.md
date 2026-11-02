# Atomax CAD house rules (every drawing)

How Atomax-UK draws, whatever the client. These sit under the client's own wishes: when a job's rules or the client profile say something different, they win.

## Text
- Text height 2 everywhere on the drawing (labels, cable text, notes). Never smaller. Titles and headings may be larger (border text is the border's own).
- All text in CAPITALS, as on our issued drawings, except units written the normal way (mm², kW, kVA, A, V).
- Anything over one line is MTEXT, never stacked single lines.
- Text never touches or crosses linework or other text. Leave clear space round every label.
- Cable text along a vertical cable is written up the cable (rotated 90°), beside the line, not on it.

## Linework
- Cables never overlap or cross each other. Re-order the blocks before accepting a crossing.
- Runs are straight lines. A dog-leg only where two things cannot both be level.
- Symbols are joined to their conductors with no gaps.
- Field / site cables may be drawn dashed where the house style for that drawing does (outgoing cables to field devices on SLDs).

## Borders and sheets
- The border belongs to who the drawing is for: Atomax jobs on the Atomax border; BGEN jobs on the BGEN border; National Grid jobs on the National Grid sheet; other clients on their own title block when we have it (Clients cabinet), otherwise the Atomax border.
- Smallest sheet the drawing fits at 1:1 (A3, A2, A1, A0). Never shrink the drawing to fit; go up a size.
- The drawing sits in the middle of the drawing area.

## Numbering and revisions (QS 006)
- Drawing number: project ref (X + date) - area - discipline - type - sequence, e.g. X11481-01-WHT-06-71-0004. Types: 70 SLD, 71 BCD, 72 interconnection, 73 cable routing / equipment layout, 74 earthing, 23 schedules.
- Revisions are always two digits: P01, P02 (preliminary / for comment inside BGEN jobs), A01 issued for comment, C01 for construction, X01 as built, Z01 cancelled.
- Revision history is cumulative: every earlier revision stays in the box, newest on top, each with its description (e.g. ISSUED FOR COMMENT), date, drawn / checked / approved initials.
- Changes from the last revision get a revision triangle with the revision number beside each changed item; open questions get a HOLD cloud and a note.

## Notes column
- NOTES heading, then numbered notes in capitals.
- Note 1 always says where the drawing came from, e.g. "DRAWING DERIVED FROM SITE PROVIDED CABLE SCHEDULE "<ref>", HENCE DRAWINGS MAY NOT BE ACCURATE AS INFORMATION PROVIDED HAS NOT BEEN VERIFIED, AS SUCH THIS DRAWING SHOULD BE CROSS-CHECKED ON SITE BEFORE USE." when the source is unverified site information.
- Then the standard installation notes that apply (BS 7671:2018 (AS AMENDED), segregation of signal and power cables (BS 7671 528.1), containment to BS 7671 Section 522, vendor cables to be verified against vendor documentation, cable ID labels at both ends (BS 7671 514), ATEX equipment certified for the zone, cables glanded and earthed at both ends unless shown otherwise).
- Anything TBC gets a note saying what is missing and who confirms it.
- LEGEND under the notes when the drawing uses symbols or colours that need a key.
- REFERENCES: numbered list of related drawings and schedules as "<drawing number> - <title>".

## Only what is written
- Copy tags, cable numbers, cores, sizes and types exactly as printed in the source documents. Never invent a tag; where a source gives only a description, use the description.
- Obvious typos in the source are not copied: flag them in a note.
- Unknown values are TBC, with a note. Never guess a rating or a size.
