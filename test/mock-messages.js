// A stand-in for the Anthropic Messages API (streaming) so the agent runner can be tested end to end without a key.
// script: an array of turns; each turn is a list of blocks ({type:'text',text} or {type:'tool_use',name,input}), served in order
// to the agent's main calls (calls with tools). Other calls (titles, summaries) get a short text.
'use strict';
const http = require('http');
function start(script, { port = 0, log = [] } = {}) {
  let i = 0;
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      let j = {}; try { j = JSON.parse(body || '{}'); } catch {}
      log.push({ url: req.url, body: j });
      if (!/\/v1\/messages/.test(req.url)) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}'); }
      if (/count_tokens/.test(req.url)) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"input_tokens":100}'); }
      const main = Array.isArray(j.tools) && j.tools.length > 0;
      const blocks = main ? ((typeof script === 'function' ? script(j, i++) : script[i++]) || [{ type: 'text', text: 'done' }]) : [{ type: 'text', text: 'ok' }];
      const sse = (ev, d) => res.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`);
      if (!j.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id: 'msg_' + i, type: 'message', role: 'assistant', model: j.model, content: blocks.map((b, k) => b.type === 'tool_use' ? { type: 'tool_use', id: 'tu_' + i + '_' + k, name: b.name, input: b.input } : b), stop_reason: blocks.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn', usage: { input_tokens: 1000, output_tokens: 50 } }));
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sse('message_start', { type: 'message_start', message: { id: 'msg_' + i, type: 'message', role: 'assistant', model: j.model, content: [], stop_reason: null, usage: { input_tokens: 1000, output_tokens: 1 } } });
      blocks.forEach((b, k) => {
        if (b.type === 'tool_use') {
          sse('content_block_start', { type: 'content_block_start', index: k, content_block: { type: 'tool_use', id: 'tu_' + i + '_' + k, name: b.name, input: {} } });
          sse('content_block_delta', { type: 'content_block_delta', index: k, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input || {}) } });
        } else {
          sse('content_block_start', { type: 'content_block_start', index: k, content_block: { type: 'text', text: '' } });
          sse('content_block_delta', { type: 'content_block_delta', index: k, delta: { type: 'text_delta', text: b.text } });
        }
        sse('content_block_stop', { type: 'content_block_stop', index: k });
      });
      sse('message_delta', { type: 'message_delta', delta: { stop_reason: blocks.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 50 } });
      sse('message_stop', { type: 'message_stop' });
      res.end();
    });
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}`, log })));
}
module.exports = { start };
