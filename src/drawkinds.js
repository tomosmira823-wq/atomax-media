// Which kind of drawing a request is, and which skills fit it. Shared by Dex (main) and his panel (renderer, via a copy in dexmakeui).
const KINDS = [
  ['earthing', /earth|bonding/i, 'earthing'],
  ['bcd', /\bbcd\b|block cable/i, 'block cable diagram'],
  ['loop', /\bloop\b/i, 'loop diagram'],
  ['layout', /layout|general arrangement|\bga\b|cable route/i, 'layout'],
  ['sld', /\bsld\b|single.?line|one.?line/i, 'single line diagram'],
];
const GENERAL = /dxf|cad|drawing|layer|title block|text height/i;
const kindOf = (text) => (KINDS.find(k => k[1].test(text || '')) || KINDS.find(k => k[0] === 'sld'))[0];
const kindName = (kind) => (KINDS.find(k => k[0] === kind) || KINDS.find(k => k[0] === 'sld'))[2];
const skillKinds = (sk) => KINDS.filter(k => k[1].test((sk.name || '') + ' ' + (sk.file || '') + ' ' + (sk.description || ''))).map(k => k[0]);
// 'match' = made for this kind of drawing, 'general' = CAD house rules for any drawing, '' = does not fit (another kind, fixer rules, spreadsheets)
function skillFit(sk, kind) {
  const s = (sk.name || '') + ' ' + (sk.file || '');
  if (/\bfix|redline|markup|check|review|excel|xlsx|spreadsheet/i.test(s)) return '';
  const ks = skillKinds(sk);
  if (ks.length) return ks.includes(kind) ? 'match' : '';
  return GENERAL.test(s + ' ' + (sk.description || '')) ? 'general' : '';
}
module.exports = { KINDS, kindOf, kindName, skillKinds, skillFit };
