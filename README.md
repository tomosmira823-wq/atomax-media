# Atomax Media Office

A 3D office (Three.js, Electron) where each social account has its own AI agent. You give the office a brief and some images, each agent writes a post in its own voice, and the results land on the board. Runs on your own API keys.

- **Claude** (required) writes every post and reads the images.
- **OpenAI** (optional) generates images and edits the ones you upload.
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

1. **Brief** (left panel): say what the post is about, add images, tick which agents work on it, hit *Run the office*.
2. Agents walk to their desks and write. With *Make the image as part of the run* ticked, the office then edits your attached photo through OpenAI (banner, real Atomax logo supplied as a second input, exact text from the writer's suggested banner line and your reference note) or, with no photo, generates one from the writer's image idea; the result lands on every card. Each post appears on the **Board** (right panel) with Copy, Save, Generate image, Edit my image and a revise box (e.g. "shorter", "more formal", "add a line about safety").
3. **Reference**: paste an example post (or add screenshots of one) and the agents copy its style and structure without reusing its content. Post images and reference images are labelled separately so they never get mixed up. Each agent can also keep permanent **example posts** in the Agents tab, so its voice stays consistent run to run.
4. **Analyse image** asks Claude what it sees in your image and what edits would help.
5. **Agents** tab: one agent per platform. Tone is the personality, Rules are the hard limits (character count, hashtags). Add more agents for YouTube, TikTok, etc. Each enabled agent gets a desk.
6. **Posts** tab: everything the office has written, with images.
7. **Settings** tab: keys, models, image provider, and the company profile every agent reads before writing.

Default writers: Lena (LinkedIn, formal), Izzy (Instagram, casual), Frank (Facebook, community), Xander (X, off by default), Tia (TikTok, off by default).

**Reviewers.** Charlie the Checker reads every post after the writers finish and scores it out of 10 with a PASS / NEEDS WORK / FAIL verdict, what works, what's wrong, and a corrected version you can apply with one click. Add more reviewer bots in the Agents tab (*+ Add reviewer*) — each one has its own attitude and its own list of things to check, e.g. a brand guardian, a spelling pedant, an engagement coach. Reviewers wear glasses and carry a clipboard in the office.

## Furniture and look

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

## Notes

- Posting straight to LinkedIn/Instagram isn't wired in yet; copy the post or save it. That's the next step if you want it (needs each platform's OAuth app).
- Image edits use OpenAI's image edit endpoint. Claude can look at images and describe edits but can't change pixels.
- Higgsfield model endpoint can be changed in Settings (default `higgsfield-ai/soul/standard`).
