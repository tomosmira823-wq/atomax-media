// Social connections: OAuth (loopback redirect) + publishing for LinkedIn, Facebook Page, Instagram and X.
// Runs in the Electron main process. Tokens are kept in settings.social (encrypted on disk with the keys).
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');

const MOCK = process.env.AMO_MOCK === '1' ? 'http://127.0.0.1:52900' : null;
const LI_API = MOCK ? MOCK + '/li' : 'https://api.linkedin.com';
const X_API = MOCK ? MOCK + '/x' : 'https://api.x.com';
const PORT = 52817;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;

// ---------- loopback OAuth helper ----------
let active = null;
function waitForCallback(expectedState) {
  // a previous attempt (abandoned tab, double click) may still hold the port: shut it down first
  if (active) { try { active.stop(new Error('Replaced by a new connect attempt')); } catch {} active = null; }
  return new Promise((resolve, reject) => {
    let timer;
    const stop = (err) => { clearTimeout(timer); try { server.close(); server.closeAllConnections?.(); } catch {} if (active && active.server === server) active = null; if (err) reject(err); };
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
      if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const err = u.searchParams.get('error'), code = u.searchParams.get('code'), state = u.searchParams.get('state');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif;background:#0e121d;color:#e6eaf2;display:grid;place-items:center;height:100vh"><div style="text-align:center"><h2 style="color:#40bd00">${err ? 'Connection failed' : 'Connected'}</h2><p>${err ? err : 'You can close this tab and go back to Atomax Media Office.'}</p></div></body></html>`);
      clearTimeout(timer); try { server.close(); server.closeAllConnections?.(); } catch {} if (active && active.server === server) active = null;
      if (err) reject(new Error(err + (u.searchParams.get('error_description') ? ': ' + u.searchParams.get('error_description') : '')));
      else if (expectedState && state !== expectedState) reject(new Error('OAuth state mismatch'));
      else resolve(code);
    });
    active = { server, stop };
    server.on('error', (e) => stop(e.code === 'EADDRINUSE' ? new Error('Port 52817 is used by another program. Close it or restart the app, then try again.') : e));
    server.listen(PORT, '127.0.0.1');
    timer = setTimeout(() => stop(new Error('Timed out waiting for the login to finish (5 min)')), 5 * 60 * 1000);
  });
}
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function jsonOrThrow(res, label) {
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${label} ${res.status}: ${data.error?.message || data.message || data.error_description || data.error || text.slice(0, 300)}`);
  return data;
}

// ---------- LinkedIn ----------
const LI = {
  async connect(cfg) {
    if (!cfg.clientId || !cfg.clientSecret) throw new Error('LinkedIn client ID and secret needed (Settings → Connections).');
    const state = crypto.randomBytes(12).toString('hex');
    const scopes = ['openid', 'profile', 'w_member_social'];
    if (cfg.wantOrg) scopes.push('w_organization_social', 'r_organization_admin');
    const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${encodeURIComponent(cfg.clientId)}&redirect_uri=${encodeURIComponent(REDIRECT)}&state=${state}&scope=${encodeURIComponent(scopes.join(' '))}`;
    const waiting = waitForCallback(state);
    shell.openExternal(url);
    const code = await waiting;
    const tok = await jsonOrThrow(await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: cfg.clientId, client_secret: cfg.clientSecret })
    }), 'LinkedIn token');
    const me = await jsonOrThrow(await fetch(LI_API + '/v2/userinfo', { headers: { authorization: `Bearer ${tok.access_token}` } }), 'LinkedIn userinfo');
    const out = { ...cfg, token: tok.access_token, expires: Date.now() + (tok.expires_in || 0) * 1000, memberUrn: `urn:li:person:${me.sub}`, name: me.name, orgs: [] };
    if (cfg.wantOrg) {
      try {
        const r = await jsonOrThrow(await fetch(LI_API + '/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&projection=(elements*(organization~(localizedName)))', { headers: { authorization: `Bearer ${tok.access_token}`, 'LinkedIn-Version': '202409', 'X-Restli-Protocol-Version': '2.0.0' } }), 'LinkedIn orgs');
        out.orgs = (r.elements || []).map(e => ({ urn: e.organization, name: e['organization~']?.localizedName || e.organization }));
      } catch (e) { out.orgNote = 'Company pages not available yet: ' + e.message; }
    }
    if (!out.target) out.target = out.memberUrn;
    return out;
  },
  headers(cfg) { return { authorization: `Bearer ${cfg.token}`, 'LinkedIn-Version': '202409', 'X-Restli-Protocol-Version': '2.0.0', 'content-type': 'application/json' }; },
  async publish(cfg, { text, image }) {
    if (!cfg.token) throw new Error('LinkedIn not connected.');
    const author = cfg.target || cfg.memberUrn;
    let content;
    if (image) {
      const init = await jsonOrThrow(await fetch(LI_API + '/rest/images?action=initializeUpload', { method: 'POST', headers: LI.headers(cfg), body: JSON.stringify({ initializeUploadRequest: { owner: author } }) }), 'LinkedIn image init');
      const { uploadUrl, image: imageUrn } = init.value;
      const up = await fetch(uploadUrl, { method: 'PUT', headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/octet-stream' }, body: Buffer.from(image.base64, 'base64') });
      if (!up.ok) throw new Error('LinkedIn image upload ' + up.status);
      content = { media: { id: imageUrn, altText: image.alt || '' } };
    }
    const body = { author, commentary: text, visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false };
    if (content) body.content = content;
    const res = await fetch(LI_API + '/rest/posts', { method: 'POST', headers: LI.headers(cfg), body: JSON.stringify(body) });
    if (!res.ok) throw new Error('LinkedIn post ' + res.status + ': ' + (await res.text()).slice(0, 300));
    const id = res.headers.get('x-restli-id') || '';
    return { id, url: id ? `https://www.linkedin.com/feed/update/${id}/` : 'https://www.linkedin.com/feed/' };
  }
};

// ---------- Facebook Page + Instagram (Meta Graph API) ----------
const G = MOCK ? MOCK + '/fb' : 'https://graph.facebook.com/v21.0';
const FB = {
  async connect(cfg) {
    if (!cfg.appId || !cfg.appSecret) throw new Error('Meta app ID and secret needed (Settings → Connections).');
    const state = crypto.randomBytes(12).toString('hex');
    const scopes = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish', 'business_management'];
    const url = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${encodeURIComponent(cfg.appId)}&redirect_uri=${encodeURIComponent(REDIRECT)}&state=${state}&scope=${encodeURIComponent(scopes.join(','))}&response_type=code`;
    const waiting = waitForCallback(state);
    shell.openExternal(url);
    const code = await waiting;
    const tok = await jsonOrThrow(await fetch(`${G}/oauth/access_token?client_id=${cfg.appId}&client_secret=${cfg.appSecret}&redirect_uri=${encodeURIComponent(REDIRECT)}&code=${code}`), 'Meta token');
    const long = await jsonOrThrow(await fetch(`${G}/oauth/access_token?grant_type=fb_exchange_token&client_id=${cfg.appId}&client_secret=${cfg.appSecret}&fb_exchange_token=${tok.access_token}`), 'Meta long token');
    const userToken = long.access_token || tok.access_token;
    const me = await jsonOrThrow(await fetch(`${G}/me?fields=name&access_token=${userToken}`), 'Meta me');
    const pages = await jsonOrThrow(await fetch(`${G}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${userToken}`), 'Meta pages');
    const list = (pages.data || []).map(p => ({ id: p.id, name: p.name, token: p.access_token, igId: p.instagram_business_account?.id || null, igName: p.instagram_business_account?.username || null }));
    const out = { ...cfg, userToken, name: me.name, pages: list, expires: Date.now() + (long.expires_in || 60 * 86400) * 1000 };   // Meta long-lived tokens last about 60 days
    if (!out.pageId && list[0]) out.pageId = list[0].id;
    return out;
  },
  page(cfg) { const p = (cfg.pages || []).find(x => x.id === cfg.pageId) || cfg.pages?.[0]; if (!p) throw new Error('No Facebook Page found on this account.'); return p; },
  async publish(cfg, { text, image }) {
    const p = FB.page(cfg);
    if (image) {
      const fd = new FormData();
      fd.append('message', text); fd.append('access_token', p.token);
      fd.append('source', new Blob([Buffer.from(image.base64, 'base64')], { type: image.mime || 'image/png' }), 'post.png');
      const r = await jsonOrThrow(await fetch(`${G}/${p.id}/photos`, { method: 'POST', body: fd }), 'Facebook photo post');
      return { id: r.post_id || r.id, url: `https://www.facebook.com/${(r.post_id || r.id).replace('_', '/posts/')}` };
    }
    const r = await jsonOrThrow(await fetch(`${G}/${p.id}/feed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: text, access_token: p.token }) }), 'Facebook post');
    return { id: r.id, url: `https://www.facebook.com/${r.id.replace('_', '/posts/')}` };
  },
  // Instagram needs a public image URL: upload the image to the Page as an unpublished photo and use its CDN link
  async publishInstagram(cfg, { text, image }) {
    const p = FB.page(cfg);
    if (!p.igId) throw new Error(`The Page "${p.name}" has no Instagram Business account linked.`);
    if (!image) throw new Error('Instagram posts need an image.');
    const fd = new FormData();
    fd.append('published', 'false'); fd.append('access_token', p.token);
    fd.append('source', new Blob([Buffer.from(image.base64, 'base64')], { type: image.mime || 'image/png' }), 'ig.png');
    const up = await jsonOrThrow(await fetch(`${G}/${p.id}/photos`, { method: 'POST', body: fd }), 'Instagram image staging');
    const photo = await jsonOrThrow(await fetch(`${G}/${up.id}?fields=images&access_token=${p.token}`), 'Instagram image url');
    const imageUrl = photo.images?.[0]?.source;
    if (!imageUrl) throw new Error('Could not get a public URL for the image.');
    const container = await jsonOrThrow(await fetch(`${G}/${p.igId}/media`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image_url: imageUrl, caption: text, access_token: p.token }) }), 'Instagram container');
    // wait until the container is ready
    for (let i = 0; i < 20; i++) {
      const st = await jsonOrThrow(await fetch(`${G}/${container.id}?fields=status_code&access_token=${p.token}`), 'Instagram status');
      if (st.status_code === 'FINISHED') break;
      if (st.status_code === 'ERROR') throw new Error('Instagram rejected the image.');
      await new Promise(r => setTimeout(r, 2000));
    }
    const pub = await jsonOrThrow(await fetch(`${G}/${p.igId}/media_publish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ creation_id: container.id, access_token: p.token }) }), 'Instagram publish');
    let url = 'https://www.instagram.com/' + (p.igName || '');
    try { const m = await jsonOrThrow(await fetch(`${G}/${pub.id}?fields=permalink&access_token=${p.token}`), 'Instagram permalink'); if (m.permalink) url = m.permalink; } catch {}
    return { id: pub.id, url };
  }
};

// ---------- X (OAuth 2.0 PKCE) ----------
const X = {
  async connect(cfg) {
    if (!cfg.clientId) throw new Error('X client ID needed (Settings → Connections).');
    const state = crypto.randomBytes(12).toString('hex');
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const scopes = ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write'];
    const url = `https://x.com/i/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(cfg.clientId)}&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=${encodeURIComponent(scopes.join(' '))}&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;
    const waiting = waitForCallback(state);
    shell.openExternal(url);
    const code = await waiting;
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };
    if (cfg.clientSecret) headers.authorization = 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
    const tok = await jsonOrThrow(await fetch(X_API + '/2/oauth2/token', { method: 'POST', headers, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: cfg.clientId, code_verifier: verifier }) }), 'X token');
    const me = await jsonOrThrow(await fetch(X_API + '/2/users/me', { headers: { authorization: `Bearer ${tok.access_token}` } }), 'X me');
    return { ...cfg, token: tok.access_token, refresh: tok.refresh_token, expires: Date.now() + (tok.expires_in || 7200) * 1000, name: me.data?.username };
  },
  async refreshIfNeeded(cfg, save) {
    if (!cfg.refresh || Date.now() < (cfg.expires || 0) - 60000) return cfg;
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };
    if (cfg.clientSecret) headers.authorization = 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
    const tok = await jsonOrThrow(await fetch(X_API + '/2/oauth2/token', { method: 'POST', headers, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cfg.refresh, client_id: cfg.clientId }) }), 'X refresh');
    const out = { ...cfg, token: tok.access_token, refresh: tok.refresh_token || cfg.refresh, expires: Date.now() + (tok.expires_in || 7200) * 1000 };
    await save(out); return out;
  },
  async publish(cfg, { text, image }, save) {
    cfg = await X.refreshIfNeeded(cfg, save);
    const body = { text };
    if (image) {
      const fd = new FormData();
      fd.append('media', new Blob([Buffer.from(image.base64, 'base64')], { type: image.mime || 'image/png' }), 'post.png');
      fd.append('media_category', 'tweet_image');
      const up = await jsonOrThrow(await fetch(X_API + '/2/media/upload', { method: 'POST', headers: { authorization: `Bearer ${cfg.token}` }, body: fd }), 'X media upload');
      const mediaId = up.data?.id || up.media_id_string || up.id;
      if (mediaId) body.media = { media_ids: [String(mediaId)] };
    }
    const r = await jsonOrThrow(await fetch(X_API + '/2/tweets', { method: 'POST', headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), 'X post');
    return { id: r.data?.id, url: `https://x.com/${cfg.name || 'i'}/status/${r.data?.id}` };
  }
};

module.exports = { LI, FB, X, REDIRECT };
