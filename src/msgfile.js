// Reads Outlook .msg files properly. A .msg is a Compound File (OLE / CFB): a small file system of storages and streams.
// We read the subject, sender, headers, the HTML / plain body, and every attachment (name, type, bytes).
'use strict';

function readCfb(buf) {
  if (buf.readUInt32LE(0) !== 0xE011CFD0 || buf.readUInt32LE(4) !== 0xE11AB1A1) throw new Error('not an Outlook .msg file');
  const ss = 1 << buf.readUInt16LE(0x1E), mss = 1 << buf.readUInt16LE(0x20);
  const nFat = buf.readUInt32LE(0x2C), dir0 = buf.readUInt32LE(0x30), cutoff = buf.readUInt32LE(0x38);
  const mfat0 = buf.readUInt32LE(0x3C), nMfat = buf.readUInt32LE(0x40), difat0 = buf.readUInt32LE(0x44);
  const off = (n) => (n + 1) * ss;
  // FAT sector list: 109 in the header, the rest in DIFAT sectors
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) { const v = buf.readUInt32LE(0x4C + i * 4); if (v < 0xFFFFFFFA) fatSecs.push(v); }
  for (let d = difat0, guard = 0; d < 0xFFFFFFFA && fatSecs.length < nFat && guard++ < 10000;) {
    for (let i = 0; i < ss / 4 - 1 && fatSecs.length < nFat; i++) { const v = buf.readUInt32LE(off(d) + i * 4); if (v < 0xFFFFFFFA) fatSecs.push(v); }
    d = buf.readUInt32LE(off(d) + ss - 4);
  }
  const fat = []; for (const s of fatSecs) for (let i = 0; i < ss / 4; i++) fat.push(buf.readUInt32LE(off(s) + i * 4));
  const chain = (start, table) => { const out = []; for (let s = start, g = 0; s < 0xFFFFFFFA && g++ < 1e6; s = table[s]) out.push(s); return out; };
  const readBig = (start, size) => Buffer.concat(chain(start, fat).map(s => buf.subarray(off(s), off(s) + ss))).subarray(0, size);
  // directory
  const dirBuf = Buffer.concat(chain(dir0, fat).map(s => buf.subarray(off(s), off(s) + ss)));
  const ents = [];
  for (let p = 0; p + 128 <= dirBuf.length; p += 128) {
    const nl = dirBuf.readUInt16LE(p + 64);
    ents.push({ name: dirBuf.toString('utf16le', p, p + Math.max(0, nl - 2)), type: dirBuf[p + 66], left: dirBuf.readUInt32LE(p + 68), right: dirBuf.readUInt32LE(p + 72), child: dirBuf.readUInt32LE(p + 76), start: dirBuf.readUInt32LE(p + 116), size: dirBuf.readUInt32LE(p + 120) });
  }
  const root = ents[0];
  const miniStream = root ? readBig(root.start, root.size) : Buffer.alloc(0);
  const mfat = []; for (const s of chain(mfat0, fat).slice(0, nMfat || 1e9)) for (let i = 0; i < ss / 4; i++) mfat.push(buf.readUInt32LE(off(s) + i * 4));
  const readMini = (start, size) => Buffer.concat(chain(start, mfat).map(s => miniStream.subarray(s * mss, s * mss + mss))).subarray(0, size);
  const data = (e) => e.size < cutoff ? readMini(e.start, e.size) : readBig(e.start, e.size);
  // children of a storage: walk its red-black tree of siblings
  const children = (idx) => { const out = [], st = [ents[idx].child]; while (st.length) { const i = st.pop(); if (i >= ents.length || i === 0xFFFFFFFF) continue; out.push(i); st.push(ents[i].left, ents[i].right); } return out; };
  return { ents, children, data };
}

// the HTML body is bytes in the message's code page: UTF-8 when it says so (or decodes cleanly), else Windows-1252
function decodeHtml(b) {
  const head = b.subarray(0, 3000).toString('latin1');
  const u = b.toString('utf8');
  if (/charset="?utf-8/i.test(head) || !u.includes('\uFFFD')) return u;
  return b.toString('latin1');
}

function readMsg(buf) {
  const cf = readCfb(buf);
  const kids = (i) => Object.fromEntries(cf.children(i).map(c => [cf.ents[c].name, c]));
  const top = kids(0);
  const str = (map, id) => { const i = map['__substg1.0_' + id + '001F']; if (i !== undefined) return cf.data(cf.ents[i]).toString('utf16le').replace(/\0+$/, ''); const j = map['__substg1.0_' + id + '001E']; return j !== undefined ? cf.data(cf.ents[j]).toString('latin1').replace(/\0+$/, '') : ''; };
  const bin = (map, id) => { const i = map['__substg1.0_' + id + '0102']; return i !== undefined ? cf.data(cf.ents[i]) : null; };
  const html = bin(top, '1013'), htmlText = html ? html.toString('latin1') : '';
  const attachments = [];
  for (const [name, i] of Object.entries(top)) {
    if (!name.startsWith('__attach_version1.0_')) continue;
    const a = kids(i), bytes = bin(a, '3701');
    if (!bytes || !bytes.length) continue;   // an attached email or OLE object: skipped
    const fname = str(a, '3707') || str(a, '3704') || 'attachment';
    const cid = str(a, '3712');   // pictures the email body shows inline (logos, signatures) are not real attachments
    const hidden = !!(cid && htmlText.includes('cid:' + cid)) || (/^image\d+\.(png|jpe?g|gif)$/i.test(fname) && bytes.length < 60000);
    attachments.push({ name: fname, mime: (str(a, '370E') || '').toLowerCase(), data: bytes, inline: hidden });
  }
  return {
    subject: str(top, '0037'), fromName: str(top, '0C1A'), fromEmail: str(top, '5D01') || str(top, '0C1F'), to: str(top, '0E04'), cc: str(top, '0E03'),
    headers: str(top, '007D'), text: str(top, '1000'), html: html ? decodeHtml(html) : null, attachments
  };
}

module.exports = { readMsg, readCfb };
