# AI Engineer Brief – David Mira (LV, HV & Instrumentation)

Nov 6, 2026 · @david mira

## 1. Purpose

This brief describes what I do day to day as Director / Lead E&I Engineer at Atomax-UK Ltd, so that an autonomous agentic workflow can be built to replicate it. It covers three disciplines – **LV**, **HV** and **Instrumentation & Control** – plus the document control, QA and commercial work that wraps around them.

The target is an "AI engineer" that can take a client enquiry or design input pack and produce checked, Atomax-format deliverables ready for a human engineer to review, approve and issue. It is **not** a replacement for the competent person / designer of record – see Section 9.

## 2. Operating context

- **Firm:** Atomax-UK Ltd, Ellesmere Port. Electrical consultancy – HV, LV and instrumentation design, conception to completion. ISO 9001, SafeContractor.
- **Sectors:** utilities (water, National Grid / transmission), heavy industry, refining & chemicals (COMAH Tier 1), food & drink, nuclear, tunnelling / infrastructure, renewables (PV, BESS, wind).
- **Typical clients:** Sellafield, Ferrovial, Laing O'Rourke, Arup, M Group, OCU, PBE, Welsh Water, United Utilities, Essar, Diageo, Kimberly-Clark / Arbex, Ameresco, BGEN (for National Grid).
- **Voltage range:** 230/400V LV up to 6.6kV, 11kV, 20kV, 33kV, with interface work at 275kV and 400kV sites (LVAC, earthing, impressed voltage).
- **Project types:** containerised / E-house substations, switchgear replacements, LVAC upgrades, new plant supplies, G99/G100 connections, protection studies, earthing studies, instrument loop / IO design, hazardous area design.
- **Data environments:** SharePoint for most clients; standalone server for high-security / nuclear clients. The agent must respect this split (no cloud processing of high-security data).

## 3. A typical day

No two days are the same, but the work falls into a repeating loop:

1. **Inbox triage** – client enquiries, RFIs, comment registers, NCRs, site queries from subcontractors. Classify: tender / design / site support / commercial / QA.
2. **Tender & scoping** – read the enquiry pack (spec, SLDs, layouts, P&IDs, programme), write scope / assumptions / exclusions, estimate hours against the Atomax rate card, produce a fee proposal.
3. **Design production** – calculations, studies, drawings, schedules and reports across LV / HV / I&C (Sections 4–6).
4. **Checking** – checking my own and my engineers' work (Terry, Colin, Tom) before issue; cross-checking drawings vs schedules vs calcs.
5. **Document control** – numbering (QS.006), register updates, revision control, transmittals, issue packages.
6. **Site & commissioning support** – SAT/ITP preparation, test sheets, witnessing, punch lists, answering site RFIs, RAMS review.
7. **Client & subcontractor management** – meetings, progress reports, comment responses, variations.
8. **Commercial** – POs, invoicing (Xero), cost tracking, variations.

## 4. LV engineering (≤1kV)

**Typical inputs:** load lists / schedules, existing SLDs, site survey notes, supply data (Ze, PSCC, transformer rating), cable routes and lengths, installation methods, client spec.

**What I do:**

- **Load schedules & maximum demand** – build / check load schedules, diversity, spare capacity, transformer and board sizing (e.g. Arbex boiler-plant load check, Diageo Nexus new loads).
- **Cable sizing & verification** to BS 7671 – current-carrying capacity with correction factors (Ca, Cg, Ci, Ct), voltage drop, Zs / disconnection times, adiabatic (k²S² ≥ I²t), CPC sizing. Done in Amtech / Trimble ProDesign, then reported.
- **Fault levels** – prospective fault current at each board, breaking capacity checks of MCCBs / ACBs.
- **Protection coordination / discrimination** – MCCB / ACB settings (LSI), fuse-breaker discrimination, TCC plots, settings tables (e.g. Rayleigh LVAC study).
- **LVAC design at substations** – LVAC boards, changeover, standby diesel generator sizing and integration (National Grid sites via BGEN, e.g. Bustleholme 275kV).
- **New plant supplies** – identifying spare ways, specifying new outgoing circuits, MCC buckets (e.g. ClO₂ / Oxonia feeds).
- **Earthing & bonding** – system earthing arrangement (TN-S / TN-C-S / TT), main bonding, earth bar schematics.
- **Energy metering / monitoring** – meter selection, CT ratios, RS-485 / Modbus TCP architecture.
- **Trace heating** – circuit design, heat-loss, vendor (Raychem) coordination.

**Typical outputs:** LV SLDs (DXF), cable schedules, cable calc reports, load schedules, discrimination studies with TCCs, protection settings schedules, LV specs, board GA mark-ups, BoQs.

**Key standards:** BS 7671 (current amendment), BS EN 61439, BS EN 60947, BS EN 60898, IEC 60364, Electricity at Work Regulations 1989, client specs (e.g. National Grid TS documents).

## 5. HV engineering (>1kV – 3.3kV to 33kV, with EHV interfaces)

**Typical inputs:** DNO / NG supply data (fault level, X/R, earthing), existing SLDs and protection settings, relay manuals, CT/VT data, transformer test certs, switchgear data, connection offers.

**What I do:**

- **HV SLDs & substation design** – containerised / packaged substations (11kV/400V, 13.8kV/400V, 20kV/3.3kV/400V), RMUs, switchboards, transformers, NERs.
- **Fault current calculations** – IEC 60909 short-circuit (3-phase, phase-earth), contribution from transformers / generation / motors, equipment duty checks.
- **Protection design & grading** – IDMT / DT overcurrent and earth fault grading (IEC SI/VI/EI curves), REF stability and setting calculations, transformer differential, CT knee-point / Vk calcs, CT-powered vs aux-powered relay selection, settings files and schedules.
- **Switchgear works** – replacement strategies (e.g. Stanlow 6.6kV, Guinness Runcorn Reyrolle 11kV), relay retrofits, cable box works, outage phasing.
- **HV cable sizing** – ampacity, short-circuit rating of conductor and screen, voltage drop, installation conditions.
- **Earthing design & studies** – substation earth grid design, EPR, touch / step voltages, hot / cold site assessment, transfer potentials (ENA TS 41-24, BS EN 50522, IEEE 80).
- **Impressed / induced voltage assessments** – e.g. 400kV cable tunnel (Grain–Tilbury) – earthing decisions for tunnel services.
- **Grid connections** – G99 applications and protection (LoM, RoCoF, vector shift, NVD), G100 export limitation schemes, reverse power panels, G5/5 harmonic assessments (e.g. Five Fords, Gwrhyd, Warrington solar).
- **Commissioning & maintenance** – SAT sheets, primary / secondary injection test plans, VCB maintenance, energisation procedures, switching programmes, BCDs (incl. National Grid energisation BCDs).

**Typical outputs:** HV SLDs, protection philosophy docs, relay settings calcs and schedules, TCC / grading curves, fault level reports, earthing reports & drawings, G99/G100 documents, specifications, SAT / ITP packs, BCDs.

**Key standards:** IEC 60909, IEC 60255, IEC 61869 (CTs/VTs), IEC 62271, IEC 60076, ENA EREC G99 / G100 / G5/5 / P2, ENA TS 41-24, BS EN 50522, BS 7430, National Grid TS / TGNs, DNO specs (SPEN, ENWL etc.).

## 6. Instrumentation & Control (incl. hazardous areas)

**Typical inputs:** P&IDs, instrument lists / datasheets, cause & effect charts, process descriptions, hazardous area classification drawings, vendor manuals, existing loop / IO drawings.

**What I do:**

- **P&ID review & RFIs** – check instrument tags, signal types, missing devices, raise clarification RFIs.
- **Instrument & IO schedules** – instrument index, IO lists, tag-to-terminal schedules for remote IO panels (e.g. Wheat Mill / Malt RIO1 & RIO2).
- **Loop / termination / interconnection drawings** – field device → cable → JB → multicore → panel / RIO terminals (Atomax standard and OCU styles).
- **Hazardous area design** – equipment selection by zone, gas group and T-class; IS loop entity checks (Ui/Ii/Pi vs Uo/Io/Po, Ci/Li vs Co/Lo, cable parameters); barrier / isolator selection (MTL, Pepperl+Fuchs); Ex d / Ex e / Ex i installation design; DSEAR / ATEX / IECEx documentation.
- **Safety systems** – pressure-initiated solenoid valve trip systems, safety relay / PNOZmulti logic, SIL / PL considerations.
- **Control panels & networks** – panel specs, PLC / RIO architecture, Modbus / Ethernet comms, power meter networks.
- **Cable schedules & routing** for instrument cables, segregation from power.

**Typical outputs:** instrument index, IO schedules, termination / interconnection drawings (DXF), loop diagrams, IS calc sheets, hazardous area dossiers, cause & effect, control philosophy, panel specs.

**Key standards:** BS EN 60079-14 / -11 / -25 / -17, DSEAR 2002, ATEX 2014/34/EU (UKEX), IEC 61508 / 61511, BS EN ISO 13849, BS EN 60204-1, ISA 5.1 (tagging).

## 7. Cross-discipline workflows (the ones most worth automating)

| Workflow | Steps | Output |
| --- | --- | --- |
| Tender / fee proposal | Read enquiry pack → extract scope → list deliverables → estimate hours by role → assumptions & exclusions → price | Fee proposal / scope doc (Atomax Word format) |
| Deliverables list & register | Read design programme → propose drawings / docs → number to QS.006 (X######-####-##-##-####) → populate .xlsm register | Document register |
| Next doc number | Scan project folder → find next free number → add to register | Number + register entry |
| Drawing production | Pick template (SLD, BCD, NG BCD, termination, earthing) → draw in model space → project border in layout | DXF in project folder |
| Calc → report | Run calc in tool → check results → write report with method, inputs, assumptions, results, limitations | Calc report (.docx / PDF) |
| Pre-issue check | Check every doc in folder: cross-refs, title block / number / rev, breakers, cables, terminations, tags, spelling, engineering sense | Check spreadsheet (Error / Query / Comment + Engineer Decision column) |
| Fix | Action only the fixes the engineer marked "Approve fix" | Revised docs |
| Transmittal issue | Find TO BE ISSUED in register → PDF each drawing **from native DXF/DWG layout** (never from checking folder) → render-check every PDF → build ISSUE n folder → run register macro → transmittal X######-T-00n → PDF | Issue package |
| Comment response | Read client comment register → draft responses per comment → identify drawing changes | Completed comment register |
| Site / SAT support | Build SAT / ITP sheets from equipment data and settings | SAT pack, ITPs |

All Excel deliverables use the Atomax Control Page front sheet and standard header, A3 landscape. All Word deliverables use the Atomax document template (logo header, cover, Notice, Project Details / Approval / Revision tables, ToC, numbered headings).

## 8. Tools & systems the agent must work with

- **CAD:** AutoCAD / AutoCAD LT; DXF generation (Python / ezdxf) from Atomax templates in `ATOMAX ALL TEMPLATES.dwt`.
- **Power-system studies:** Amtech / Trimble ProDesign (LV), ETAP, SKM; in-house tools – TCC graph tool, power-systems app (IEC 60909 SC, load flow), EarthGrid (earthing), G5 harmonic tool, IS entity calculator, SAT configurators (transformer, 11kV switchboard, NER, REF calc).
- **Other engineering:** MATLAB, CAESAR II (mechanical interface).
- **Office:** Excel (.xlsm registers with macros), Word, PDF.
- **Document storage:** SharePoint; standalone secure server for high-security clients.
- **Commercial:** Xero.
- **Email / calendar** for enquiries, RFIs and transmittals.

## 9. Autonomy levels – what the AI may and may not do

This is the most important section for the build. Engineering liability sits with a competent human.

| Level | AI may do unattended | Examples |
| --- | --- | --- |
| **A – Full autonomy** | Admin and data handling with no engineering judgement | Numbering, register updates, file filing, PDF rendering, transmittal drafting, formatting, spelling / title-block checks |
| **B – Draft for review** | Produce engineering deliverables, flagged DRAFT, with all assumptions listed | Calcs, studies, SLDs, schedules, reports, fee proposals, RFI drafts, comment responses |
| **C – Advise only** | Recommend, never decide | Protection settings to be applied, earthing safety conclusions, hazardous area equipment acceptance, SIL / safety function design, outage / switching sequences |
| **D – Never** | Human only | Signing / approving / issuing to client, certifying (EIC, test certs), issuing permits / sanction-to-test, anything on live systems, sending commercial commitments |

Rules the agent must follow:

- Every output carries an **inputs and assumptions** list and a **limitations** section – no silent assumptions.
- Where data is missing, **stop and raise a Query / RFI** rather than guess (e.g. unknown Ze, CT ratio, cable length, gas group).
- Calculations must be **traceable** – show method, standard clause, inputs, and results, so a checker can re-run them.
- Nothing leaves Atomax without an engineer's "Approve" in the check sheet.
- High-security / nuclear project data stays on the standalone server.

## 10. Inputs → outputs summary

| Input the AI receives | Output the AI should produce |
| --- | --- |
| Client enquiry email + tender pack | Scope, assumptions/exclusions, deliverables list, hour estimate, fee proposal draft |
| Load list + supply data | Load schedule, MD, transformer / board sizing, cable calcs, LV SLD |
| Existing SLD + relay data + fault level | Fault study, grading study, TCCs, settings schedule, protection report |
| Site earthing data + soil resistivity | Earthing design, EPR / touch / step assessment, earthing drawing |
| P&IDs + instrument list | P&ID RFI, instrument index, IO schedule, termination drawings |
| Hazardous area drawings + device certs | IS loop calcs, equipment compliance check, hazardous area dossier |
| Folder of drawings ready to issue | Pre-issue check sheet, then transmittal package |
| Client comment register | Draft responses + list of required revisions |

## 11. Risks & limitations to design for

- **Hallucinated data** – the biggest risk. The agent must only use values from inputs, standards or manufacturer data, and cite the source.
- **Standards versions** – BS 7671 amendments, ENA document revisions (e.g. G5/4-1 → G5/5) change; the agent needs a controlled, versioned standards library.
- **Tool interoperability** – Amtech, ETAP, SKM and AutoCAD are licensed desktop tools; the agent may need export/import files or desktop automation rather than APIs.
- **Drawing quality** – generated DXFs must be rendered and visually checked every time; text overlap, wrong layer, wrong border are common failures.
- **Context loss on large jobs** – multi-hundred-document projects need a project knowledge base (register, SLD, cable schedule as master data).
- **Liability & PI insurance** – client contracts and PI cover assume a human designer; the human-in-the-loop gates in Section 9 are mandatory.

## 12. Questions for the developer

- What platform does the agent run in, and can it reach SharePoint and the standalone server separately?
- Can it drive desktop software (AutoCAD LT, Amtech, ETAP) or only work with exported files?
- How will it store project master data and Atomax templates / standards?
- How are the human approval gates enforced and logged (audit trail for ISO 9001)?
- Who owns the IP in the in-house tools once integrated?
