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
