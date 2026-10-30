// Atomax-UK QS 006 Rev 1 — Standard project document numbering:  AAAAAAAA-BBBB-CC-DD-EEEE_RevFF
//   AAAAAAAA  Atomax project reference (X + the date, e.g. X301026)
//   BBBB      area identifier (the client's area code, e.g. MLT)
//   CC        discipline (05 instrumentation, also used for combined E&I in which case 06 is not used; 06 electrical ...)
//   DD        document type (70 SLD, 71 BCD, 23 schedules ...)
//   EEEE      sequence number from 0001 for each document type
//   FF        revision: P01.. preliminary (internal), A01.. issued for comment, C01.. for construction, X01.. as built, Z01 cancelled
'use strict';
const DISCIPLINE = { '00': 'HSEQ', '01': 'Project', '02': 'Plant', '03': 'Process', '04': 'Piping', '05': 'Instrumentation (or combined E&I)', '06': 'Electrical', '07': 'Civil & Structural', '08': 'Construction', '09': 'Scaffolding', '10': 'Installation & Painting', '11': 'Start Up & Commissioning', '12': 'Process Control Systems', '13': 'Document Control', '14': 'Project Close Out' };
const DOC_TYPE = {
  '00': 'General documents, project definition, PEP, QP', '01': 'Registers', '02': 'Estimates', '03': 'Scope of work', '04': 'Correspondence', '05': 'Specifications', '06': 'BOM', '07': 'Data sheets', '08': 'Calculations', '09': 'Reports', '10': 'Diagrams', '11': 'Mass & energy balance sheets', '12': "ELD's / PID's", '15': 'Health & safety documents', '16': 'Requisition', '17': 'Bid analysis', '18': 'Review', '19': 'Programme', '20': 'Assessment', '21': 'Analysis', '22': 'Technical query', '23': 'Schedules', '24': 'General arrangement drawing', '25': 'Tie-in (TIP) / disinvestment drawing', '26': 'Miscellaneous',
  '46': 'Process ducting', '47': 'Process equipment details', '48': 'Miscellaneous (mechanical)', '49': '3D model', '50': 'Equipment layout GA', '51': 'Fabrication isometrics', '52': 'Isometrics', '53': 'Composite isometrics', '54': 'Stress isometrics', '55': 'Surge isometrics', '56': 'Registered pipeline isometrics', '57': 'Piping special details', '58': 'Pipe support details',
  '60': 'Site layouts, T&C planning drawings', '61': 'General civil & building work', '62': 'Reinforcement drawings', '63': 'Fabrication details', '64': 'HVAC', '65': 'Platforms & access', '66': 'Miscellaneous (civil)',
  '70': 'SLD', '71': 'BCD', '72': 'Interconnection diagram', '73': 'Cable routing and equipment layout', '74': 'Earthing report & calculation'
};
// what a deliverable is called → its document type code
const TYPE_OF = [
  [/\bsld\b|single.?line/i, '70'], [/\bbcd\b|block cable/i, '71'], [/interconnect|loop/i, '72'], [/cable rout|equipment layout|cable layout/i, '73'], [/earthing (report|calc)|earthing/i, '74'],
  [/cable schedule|schedule/i, '23'], [/register/i, '01'], [/technical query|\btq\b|\brfi\b/i, '22'], [/calc/i, '08'], [/report|technical note/i, '09'], [/spec/i, '05'], [/data ?sheet/i, '07'],
  [/general arrangement|\bga\b/i, '24'], [/tie.?in/i, '25'], [/\bbom\b|bill of material/i, '06'], [/estimate|quot/i, '02'], [/scope/i, '03'], [/letter|correspondence|transmittal/i, '04'], [/rams|method statement|risk assess|health|safety/i, '15'],
  [/p&id|pid|eld/i, '12'], [/3d model|model/i, '49'], [/diagram/i, '10'],
];
const typeCode = (what) => (TYPE_OF.find(([re]) => re.test(String(what || ''))) || [null, '26'])[1];
// QS 006 numbers: project ref (letter + digits, may have its own -NN), then area, discipline, type and sequence
const QS_RE = /^(X\d{4,6}(?:-\d{2})?)-([A-Z0-9]{2,4})-(\d{2})-(\d{2})-(\d{4})$/i;
function parse(no) { const m = String(no || '').toUpperCase().match(QS_RE); return m ? { project: m[1], area: m[2], disc: m[3], type: m[4], seq: +m[5] } : null; }
// the job's numbering habits, read from the numbers already on its register (project ref, area, discipline)
function habits(job) {
  const ps = (job.drawings || []).map(d => parse(d.no)).filter(Boolean);
  const top = (k) => { const c = {}; ps.forEach(p => { c[p[k]] = (c[p[k]] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || ''; };
  return { project: top('project') || job.number, area: top('area'), disc: top('disc') || (ps.length ? '' : '06') };
}
// the next free number for a deliverable on a job; area/discipline can be given, else they follow the register. Returns '' when the area is unknown.
function next(job, what, { area = '', disc = '', taken = [] } = {}) {
  const h = habits(job), dd = typeCode(what), cc = disc || h.disc || '06', bb = String(area || h.area || '').toUpperCase();
  if (!bb) return { no: '', why: 'No area code yet: set it on the job desk (e.g. MLT)', type: dd, disc: cc };
  const prefix = `${h.project}-${bb}-${cc}-${dd}-`;
  const used = [...(job.drawings || []).map(d => d.no), ...taken].map(n => String(n).toUpperCase()).filter(n => n.startsWith(prefix)).map(n => parseInt(n.slice(prefix.length), 10) || 0);
  return { no: prefix + String(Math.max(0, ...used) + 1).padStart(4, '0'), type: dd, disc: cc };
}
// revisions in QS 006 order; always two digits (P01)
const STAGES = { preliminary: 'P', comment: 'A', construction: 'C', asbuilt: 'X', cancelled: 'Z' };
function nextRev(cur, stage = '') {
  const m = String(cur || '').toUpperCase().match(/^([A-Z])(\d+)$/), pad = Math.max(2, m ? m[2].length : 2);   // Atomax revisions are two digits: P01, A01, C01
  const want = stage ? STAGES[stage] : (m ? m[1] : 'P');
  if (!m || m[1] !== want) return want + '1'.padStart(pad, '0');
  return want + String(+m[2] + 1).padStart(pad, '0');
}
// a new job's reference: X + the date (DDMMYY); a second job on the same day gets -02, -03 ...
function jobNumber(known = [], d = new Date()) {
  const base = 'X' + String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + String(d.getFullYear()).slice(2);
  const set = new Set(known.map(k => String(k).toUpperCase()));
  if (!set.has(base)) return base;
  for (let i = 2; i < 100; i++) { const n = base + '-' + String(i).padStart(2, '0'); if (!set.has(n)) return n; }
  return base;
}
const RULES_TEXT = `ATOMAX DOCUMENT NUMBERING (QS 006 Rev 1): AAAAAAAA-BBBB-CC-DD-EEEE_RevFF = project ref (X + date) - area code - discipline (05 instrumentation or combined E&I, 06 electrical) - document type (70 SLD, 71 BCD, 72 interconnection diagram, 73 cable routing & equipment layout, 74 earthing report & calculation, 23 schedules, 01 registers, 08 calculations, 09 reports, 22 technical query, 24 GA) - sequence 0001 per type. Revisions are always two digits: P01, P02.. preliminary (internal), A01.. issued for comment, C01.. for construction, X01.. as built, Z01 cancelled. Some clients have their own numbering by agreement: the client profile says so.`;
module.exports = { DISCIPLINE, DOC_TYPE, typeCode, parse, habits, next, nextRev, jobNumber, RULES_TEXT, QS_RE };
