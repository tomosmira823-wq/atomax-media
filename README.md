# Atomax Media Office

A 3D office (Three.js, Electron) where each social account has its own AI agent. You give the office a brief and some images, each agent writes a post in its own voice, and the results land on the board. Runs on your own API keys.

- **Claude** (required) writes every post and reads the images.
- **OpenAI** (optional) generates images and edits the ones you upload.
- **Google Gemini** (optional) generates and edits images with the Nano Banana models (`gemini-nano-banana-2.1` recommended), with the photo and logo passed in as reference images. Key from https://aistudio.google.com/apikey.
- **Higgsfield** (optional) generates images with SOUL.

## Run it

```
npm install
npm start
```

First launch opens Settings. Paste your Claude key, save, done. Keys are encrypted with Windows DPAPI and only ever leave the PC to go to the provider they belong to.

## Build the setup exe

```
npm run dist
```

The installer ends up in `dist\Atomax Media Office Setup 1.0.0.exe`. It isn't code-signed, so Windows SmartScreen shows "unknown publisher" the first time: click *More info* → *Run anyway*.

## Releases and auto-update

The repo is `github.com/tomosmira823-wq/atomax-media`. Installed copies check that repo's releases on launch and every hour; when a newer version is published they download it in the background and show a *Restart to update* button in the top bar.

To ship an update: bump `"version"` in `package.json` (e.g. 1.0.1), commit and push to `main`. The workflow in `.github/workflows/build.yml` runs whenever `package.json` changes, builds the installer on a Windows runner and publishes a GitHub release `v1.0.1` with the installer, `latest.yml` and blockmap, which is what the updater reads. You can also run it by hand from the repo's Actions tab.

## Using it

1. **Brief** (left panel), in three parts. *Post*: what it's about, extra instructions, and optionally a post to match the style of. *Image*: add your photo and say what the picture should show or what to do to the photo (e.g. the banner text); each agent gets its own version in its platform's shape. *Team*: who's working on it. Hit *Run the office*.
2. Agents walk to their desks and write. With *Make the image as part of the run* ticked, the office then edits your attached photo through OpenAI (banner, real Atomax logo supplied as a second input, exact text from the writer's suggested banner line and your reference note) or, with no photo, generates one from the writer's image idea; the result lands on every card. Each post appears on the **Board** (right panel) with Copy, Save, Generate image, Edit my image and a revise box (e.g. "shorter", "more formal", "add a line about safety").
3. **Reference**: paste an example post (or add screenshots of one) and the agents copy its style and structure without reusing its content. Post images and reference images are labelled separately so they never get mixed up. Each agent can also keep permanent **example posts** in the Agents tab, so its voice stays consistent run to run.
4. **Analyse image** asks Claude what it sees in your image and what edits would help.
5. **Agents** tab: the team as cards; tap one to open its loadout — the agent on a turntable, colour swatches, gear (glasses, hard hat, headset, tie, clipboard, lanyard), role, tone, rules and example posts. *Save loadout* then *Save team*. Add more writers for YouTube, TikTok, etc. Each enabled agent gets a desk.
6. **Posts** tab: everything the office has written, with images.
7. **Settings** tab: keys, models, image provider, connections, and the company profile every agent reads before writing. Put the website address in and press **Pull from website**: the app reads the site (home, about, services, projects, contact…), and Claude writes the profile and a knowledge digest in the company's own words — services, sectors, clients the site names, facts, voice. Every writer, reviewer and image brief gets that, so "make an image about what we do" is grounded in the real site, not a guess. Pull again whenever the site changes; everything stays editable.

Default writers: Lena (LinkedIn, formal), Izzy (Instagram, casual), Frank (Facebook, community), Xander (X, off by default), Tia (TikTok, off by default).

**Reviewers.** Charlie the Checker reads every post after the writers finish and scores it out of 10 with a PASS / NEEDS WORK / FAIL verdict, what works, what's wrong, and a corrected version you can apply with one click. Add more reviewer bots in the Agents tab (*+ Add reviewer*) — each one has its own attitude and its own list of things to check, e.g. a brand guardian, a spelling pedant, an engagement coach. Reviewers wear glasses and carry a clipboard in the office.

## The drawing room and Cal (cable schedule checker)

Next door to the media office is a drawing room with one agent, **Cal**. Click the *DRAWING ROOM* sign over the door (or the *Drawing room* switch at the top) to go in, then click Cal's desk. The camera zooms to the desk and a panel opens:

1. Drop the **cable schedule** (Excel, CSV or PDF) in the first box.
2. Drop the **drawings and cross references** (PDF is best, PNG/JPG, Excel/CSV) in the second box.
3. Choose **Standard skill** (the rules in Cal's loadout, editable under Agents) or **Leave Cal a note** for extra instructions.
4. **Hand it to Cal.** The files fly onto his desk, he checks, and his progress shows above his head and in the panel.

How it checks: Claude only *reads* (maps the schedule columns, pulls cables off each drawing, judges near-miss differences). The comparison itself is plain code, run in both directions (drawings to schedule and schedule to drawings), so Cal never says "all matches" unless both directions really ran on everything. Anything he could not read (scans, DWG/DXF, oversize files) is listed under *Not checked* rather than guessed. DWG and DXF cannot be read, so export them to PDF first.

Cal also writes **marked-up copies** of every drawing with findings into a `MARKUPS` folder beside the drawings: the original page unchanged plus a strip of red notes on the right. Originals are never edited.

Drawings go to Claude through your own API key. Try it with dummy files first, and check the client contract before sending client drawings (for example National Grid work).

The room is built so more agents and departments (CAD, checking) can be added alongside Cal later. Tests: `node test/checker-test.js` (offline, fake Claude) and the scenario in `test/scenario-run.js` (drops files, runs a check, shows results).

## Dex (DXF fixer)

Dex sits on the stool at the drafting table in the drawing room. Click the table, the stool or Dex to open his panel.

1. Drop the **DXFs** to fix (ASCII `.dxf` only; DWG and binary DXF are refused).
2. Choose where the fixes come from: **Cal's last markups** (a button, uses the findings from Cal's most recent check) or **Drop markup PDFs** (Claude reads the red notes strip on each PDF).
3. **Find fixes.** Dex lists what he can change in the DXFs, with how many places each one appears. Everything starts **unticked**; use **Tick all fixes** or tick one by one.
4. **Apply ticked fixes.** Only ticked fixes are made.

What he does: swaps exact text (TEXT, MTEXT and ATTRIB values, whole-tag matches only, so `C-O102` never hits `C-O102x`) and saves `<name>_FIXED.dxf` in a `FIXED` folder next to each DXF, plus `DEX_FIX_LOG.txt`. The original is never touched and every other byte of the file is kept as it was. He can change, delete and add text. Text inside symbol (block) definitions is changed only when you leave the symbol tick on, because that changes every copy of the symbol. With no markup you can pick Just tell Dex and type the fix; Claude reads the DXF's text list and proposes changes you tick. Tests: `node test/dxffix-test.js` and `AMO_SCENARIO=dex` (needs `test/mock-api.js` running and a `last-check.json` in the user data folder).

## Milo (3D modeller) and Vera (model checker)
Both sit in the modeling room: Milo at his drafting board, Vera at a review table. Click Milo.
1. Say what should change ("a new pipe along the back of the rail"), drop a 3D model (GLB, GLTF, OBJ or STL) and optionally a context folder or files (PDF, Word, Excel, text, photos; nested folders are read, up to 40 files).
2. Milo reads the model (named parts with their boxes, plus four pictures) and the context. If something matters and is not given he asks up to four short questions first. Otherwise he returns an edit list: add pipe/box/cylinder, move, rotate, scale, delete, recolour. The edits are applied to a copy and shown on the pedestal (new parts red in the pictures Claude sees). Before/After toggle.
3. A clash test runs in code (boxes overlapping, parts sticking out, tiny parts). Then "Send to Vera": she checks the result against the request and context and passes it or sends it back with findings; "Send back to Milo" redoes it with her findings.
4. Save copy writes a GLB to the models folder (never over the original). Milo and Vera log to the audit trail.
5. Take it into AutoCAD / Plant 3D: "AutoCAD script (.scr)" draws what Milo added (3D centreline plus plain 3D solids, model Y-up converted to CAD Z-up, units scaled to mm) and "Route list (.csv)" gives start/end coordinates, diameter and length per pipe run. These are ordinary AutoCAD objects, not Plant 3D pipe objects: snap Plant 3D pipe to the centreline. Unit test: node test/plantexport-test.js.
Limits: STEP, IFC, DWG and DXF models are not opened (export a GLB). Clash test is box-based, so diagonal pipes can report false overlaps.
Test: AMO_SCENARIO=mo AMO_MO_DIR=<folder with an .obj and notes> AMO_MOCK=1 with test/mock-api.js running.

## Computer control (Milo drives Plant 3D / AutoCAD)
In Milo's result panel, "Let Milo drive Plant 3D / AutoCAD": Milo takes screenshots of the main screen and Claude's computer tool says what to click or type (default model uses the `computer_toolset_20260801` tool, no beta header; older models fall back to `computer_20251124`). Clicks, keys and typing are done on Windows with small PowerShell scripts calling user32 (`src/pcinput.js`, no native modules). The main window minimises while he works.
Safety: it only starts from the button; a small always-on-top bar (`src/pcoverlay.html`) shows each action; "Ask me before every action" is on by default (Allow / Don't); Stop on the bar or Ctrl+Alt+Q ends it; risky keys (Windows key combos, Alt+F4, Delete) always ask; 40-step limit; Milo has an `ask_user` tool and the rules not to save over originals or touch passwords; runs go in the audit trail. Screenshots go to the Claude API.
Check it works on a PC with "Test control (10 s)" (moves the mouse, presses Shift, reads the cursor back). Unit test: `node test/pcinput-test.js`. Loop test: `AMO_SCENARIO=pc AMO_PC_MOCK=1 AMO_MOCK=1` with test/mock-api.js running.
Not verified on a real Windows PC from the build environment: the PowerShell input, DPI scaling on scaled or multi-monitor setups, and real Plant 3D behaviour.

## Furniture and look

v1.1: the floor is laid out in pods of two facing workstations (slim white desks, dual monitors on an arm, keyboard, mouse, pedestal, desk plant, coloured mug and chair) with a pendant over each pod; spare pods are furnished and waiting for new agents, so adding a team (a CAD department, say) just fills them in. Windows look out on a soft skyline; the boardroom has a proper long table and pendant row; the open sides have a slim ceiling edge. Agents blink, walk with a distance-driven cycle (no sliding), lean into turns, and sit and type at their desks.

The room uses Kenney's Furniture Kit (CC0) GLB models from `src/assets/models/` (desks, chairs, computers, bookcases, sofa, coffee table, lamp, TV, fridge, vending machine, bench, plants, radio, cake), recoloured to the Atomax navy/green palette, with environment lighting, soft shadows and glossy characters. Layout: desk pods on the main floor, a glass-walled meeting room front-right, a lounge front-left, kitchenette by the meeting room, whiteboard, logo wall and live PROJECT STATUS screen on the back wall. Idle agents roam the whole room: water cooler, whiteboard, status screen, bookshelves, bench, lounge, printer, meeting room.

The page is served over an internal `app://` protocol (see `main.js`) so the model files load; keep that if you move things around. Three.js is vendored in `src/vendor/` (the packaged app does not read `node_modules` at runtime).

## Files

```
src/main.js      Electron main: settings, keys, Claude / OpenAI / Higgsfield calls
src/preload.js   bridge between the page and main
src/index.html   UI + styles
src/app.js       UI logic, running the office, board cards, history
src/office.js    the 3D office (room, furniture, desks, agents, status screen)
src/assets/      logo textures and the furniture models (CREDITS.md inside)
src/icon.*       app icon
```

Posts, agents and settings are saved in `%APPDATA%\Atomax Media Office\`.

## Brand logo

Every gpt-image call (generate or edit) gets the real logo file attached as a reference image, with instructions to reproduce it exactly, so branding isn't drawn from memory. The bundled file is the Atomax-UK logo (transparent, upscaled). Settings → Company profile → Brand logo lets you choose your own PNG (transparent background works best) or go back to the built-in one. DALL·E models can't take reference images, so with those the logo is only as good as the model's guess.

## Connecting the socials (posting from the board)

Settings → Connections. Each platform needs a developer app of your own; paste its ID/secret, press *Connect*, log in in the browser, done. Register this callback URL in every app: `http://127.0.0.1:52817/callback`. Tokens are stored encrypted with the keys. Once connected, each post card gets a *Post to …* button (with the image if there is one).

**LinkedIn** — https://www.linkedin.com/developers/apps → Create app (associate it with the Atomax company page). Products: *Sign In with LinkedIn using OpenID Connect* and *Share on LinkedIn*. Auth tab → add the callback URL; copy Client ID and Client Secret. That posts as **you**. To post as the **company page**, also request the *Community Management API* product (LinkedIn reviews it, usually a few days), then tick *Also ask for company-page posting*, reconnect, and pick the page under *Post as*.

**Facebook Page + Instagram** — https://developers.facebook.com → Create app, type *Business*. Add *Facebook Login for Business*; in its settings add the callback URL to *Valid OAuth Redirect URIs*. App settings → Basic → copy App ID and App Secret. Requirements: you're an admin of the Atomax Facebook Page, and the Atomax Instagram is a Business or Creator account linked to that Page (Instagram app → Settings → Business tools → Connect to a Facebook Page). The app can stay in Development mode for your own pages. Instagram posts always need an image; the app stages it on the Page unpublished to get a URL Instagram will accept.

**X** — https://developer.x.com → Project + App. User authentication settings: OAuth 2.0 on, type *Native App* (then leave the secret blank) or *Confidential client* (then paste the secret), permissions *Read and write*, callback URL as above, website URL anything. Free tier allows posting.

**TikTok** isn't connected: its Content Posting API only allows public posting after an app audit, so Tia's output is copy-and-paste for now.

## Testing without real keys

`test/mock-api.js` stands in for the Claude, OpenAI, LinkedIn, Meta and X endpoints. Run it (`npm run test:mock`), then start the app with `AMO_MOCK=1 AMO_USERDATA=<temp folder> AMO_SCENARIO=run AMO_SCREENSHOT=out.png npm start`. The scenario in `test/scenario-run.js` drives the real UI through a full run (brief, photo, reference, writers, reviewer, images, rewrite, history, loadout, settings, posting to each social) and prints a pass/fail report. `AMO_VARIANT=nophoto` and `AMO_VARIANT=shared` cover the generate-only and shared-image modes. All `AMO_*` switches are ignored in normal use.

## Notes

- Image edits use OpenAI's image edit endpoint. Claude can look at images and describe edits but can't change pixels.
- Higgsfield model endpoint can be changed in Settings (default `higgsfield-ai/soul/standard`).

## Theo (3D builder)
Theo sits at his own desk in the modeling room and builds a model from scratch from a prompt plus context (folders, documents, drawings, photos); an existing model is optional. He can use boxes, cylinders, spheres, cones, pipes and extruded outlines, asks questions if needed, then Vera checks the result. Save and AutoCAD export work like Milo's. Milo and Theo can both drive the PC (same control panel, Test control first).

## Office layout (v1.8)
Top row: Media office, Drawing room, Modelling room and a dashed "Next department" plot (click its "+ desk" chip to add agents). A main corridor runs below. Bottom row: Reception, Documents (Approvals and Issue pack desks open the Business tab, plus Dot the documents agent), Meeting room and Lounge. Idle agents wander between rooms.

## Jobs and the project whiteboard
The whiteboard in the meeting room opens the project board: every job, its context notes, tasks set for different agents, and who has worked on what. "Work on this job" sets the job in hand; Milo, Theo and Vera get that job as background in their prompts (not the social writers, so client details never reach posts).

## Camera
Left-drag pans freely, right-drag rotates, wheel zooms. Clicking a room flies the camera there without locking it; dragging interrupts the flight. "Whole office" shows everything.

## File room (v1.9)
Six cabinets along the west wall of the File Room: Skills, Templates, Company knowledge, Jobs, Brand and Agent rulebooks. Click a cabinet and its top drawer slides out and the panel opens. Everything is stored under userData/library/<cabinet>/. Drop files on the panel to file them in the open cabinet.
- Skills: name, description, the agents that use it (agent chips and "+ agent") and an on/off switch. "Import from Claude" takes a folder with a SKILL.md. Agents read enabled skills from the library at run time. The first run seeds today's skill text so nothing changes.
- Templates, Company knowledge, Jobs and Brand: text files are given to the agents ticked for them (text files only, up to 30 KB in total per prompt). Other file types are filed but not read.
- Agent rulebooks: one per agent. Lessons saved here are in that agent's prompt from its next run.

## Server room (v1.9)
One rack per service (Claude, OpenAI, Higgsfield, LinkedIn, Meta, X). The light on top is green when working, amber near its monthly cap and red when broken, capped or expiring.
- Every Claude, OpenAI, Google and Higgsfield image call is logged to userData/usage.json with the date, provider, agent, tokens or units, an estimated £ cost and any error. The £ figures are estimates from the list prices in src/usage.js, not billing data.
- Monthly caps (defaults £60 Claude, £30 OpenAI, £30 Google, £50 Higgsfield) are checked before every call. A capped provider stops the agent with a clear message until the cap is raised in the Server Room.
- Key test runs a cheap ping. The key itself is never shown.
- Social logins show days left. Within 7 days the panel shows a red banner and the rack goes red, with a Reconnect button.
- Bottom bar: app version and update status. Backups show "not set up yet" until a backup job exists.

## Project folders (v1.10)
Every job can point at its real folder (OneDrive, SharePoint sync or a drive). On the whiteboard's job page, "Find the folder" searches your OneDrive / SharePoint / Documents / Desktop folders by job number and name (or the folders in settings `projectRoots`), or use Choose…. The folder is read into the job's context: every file name, plus short extracts of text, Word, Excel and DXF files. Every agent that gets the job context also gets this. Output goes into the folder: Dex's DXFs into the drawings folder, approved documents into Documents, Milo and Theo's models into 3D Models, Cal's markups into MARKUPS (when the drawings were not dropped from a folder), emails into Correspondence. An existing subfolder is used if one fits; nothing is overwritten.

## Eli, the email checker (v1.10)
Eli works at the reception counter. Click him, drop an email (.eml or .msg from Outlook, a screenshot, or a PDF) or paste its text. He lists what it asks for and who should do it (Dex, Cal, Dot, Milo, Theo, or you). Nothing starts until you press "Yes, start": pick the job (his best match first, or a new job from the email), confirm the project folder he found, and the task goes on the board, the email is filed in the job's Correspondence folder, and the agent opens with the request. He also suggests a short reply.

## Dex makes DXFs (v1.10)
Dex's panel has "Make a new DXF" and "Fix a DXF". Make: pick the job, say what to draw. He reads the project folder and any SLD or schedule PDFs that match the request, asks up to four questions if something essential is missing, then saves a DRAFT R2010 DXF into the job folder with a preview. Today he makes single line diagrams: the app lays them out (symbols joined, text height 2, MTEXT labels, nothing overlapping) and anything unknown is marked TBC.

## Skills import
"Import from Claude" now takes your skills folder of .skill packages (or a folder with SKILL.md). A skill with the same name is updated, not duplicated, and skills with obvious names are ticked for the right agent.

## Ada the engineer, and Eli's admin (v1.11)
- Ada sits in the Documents room. Calculation and study tasks from emails go to her: she works through them with Claude from the email, its attachments and the project files (IEC 60909 fault levels, cable sizing, earthing estimates, feasibility questions), shows her working and sources, and saves a technical note (Markdown) in the job's Documents folder. She says plainly what still needs PowerFactory / ETAP or more data.
- Eli now does admin himself: "Yes, start" on a setup task makes the new job with the next free job number and creates its project folder (Drawings, Documents, Correspondence) next to your other job folders, then files the email in it.
- "You" is only used for decisions, prices, calls and site visits. Every task can be given to someone else with "Give to".
