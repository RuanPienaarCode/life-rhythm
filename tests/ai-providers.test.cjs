'use strict';
/* Ask AI: every provider behind one ask(). Request bodies, headers, readers
   and the words a failure shows are pinned here; nothing goes on the wire. */
const assert = require('node:assert');
require('./reminders-_stub.cjs');
const P = require('../src/ai/providers');

const system = 'You help with Rhythm.';
const messages = [
  { role: 'user', content: 'What is due today?' },
  { role: 'assistant', content: 'Two reminders.' },
  { role: 'user', content: 'Which first?' },
];

/* ---- the list ---------------------------------------------------------- */

assert.deepStrictEqual(P.PROVIDERS.map(p => p.id), ['claude-code', 'codex', 'anthropic', 'openai', 'xai', 'gemini'], 'the plan routes come first');
assert.deepStrictEqual(P.PROVIDERS.filter(p => p.kind === 'cli').map(p => p.id), ['claude-code', 'codex']);
for (const p of P.PROVIDERS.filter(p => p.kind === 'api')) assert.ok(p.model && p.keyHint && p.name, `${p.id} has a default model, key hint and name`);
assert.strictEqual(P.provider('nope').id, 'anthropic', 'an unknown id falls back to the first');
assert.strictEqual(P.provider('xai').name, 'Grok');

/* ---- bodies ------------------------------------------------------------ */

const a = P.chatBody('anthropic', { system, messages, model: 'claude-sonnet-5-5' });
assert.deepStrictEqual(a, { model: 'claude-sonnet-5-5', max_tokens: 2000, system, messages });

const o = P.chatBody('openai', { system, messages, model: 'gpt-5.5' });
assert.deepStrictEqual(o, { model: 'gpt-5.5', instructions: system, input: messages, max_output_tokens: 2000 });

const x = P.chatBody('xai', { system, messages, model: 'grok-4.7' });
assert.deepStrictEqual(x, { model: 'grok-4.7', max_tokens: 2000, messages: [{ role: 'system', content: system }, ...messages] });

const g = P.chatBody('gemini', { system, messages, model: 'gemini-flash-latest' });
assert.deepStrictEqual(g, {
  systemInstruction: { parts: [{ text: system }] },
  contents: [
    { role: 'user', parts: [{ text: 'What is due today?' }] },
    { role: 'model', parts: [{ text: 'Two reminders.' }] },
    { role: 'user', parts: [{ text: 'Which first?' }] },
  ],
  generationConfig: { maxOutputTokens: 2000 },
}, 'Gemini calls the assistant "model"');

/* ---- endpoints: the key travels in the header each API expects --------- */

assert.deepStrictEqual(P.endpoint('anthropic', 'm', 'K'), { url: 'https://api.anthropic.com/v1/messages', headers: { 'x-api-key': 'K', 'anthropic-version': '2023-06-01' } });
assert.deepStrictEqual(P.endpoint('openai', 'm', 'K'), { url: 'https://api.openai.com/v1/responses', headers: { Authorization: 'Bearer K' } });
assert.deepStrictEqual(P.endpoint('xai', 'm', 'K'), { url: 'https://api.x.ai/v1/chat/completions', headers: { Authorization: 'Bearer K' } });
assert.deepStrictEqual(P.endpoint('gemini', 'gemini-flash-latest', 'K'), { url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent', headers: { 'x-goog-api-key': 'K' } }, 'Gemini key in a header, never the URL');
assert.ok(!P.endpoint('gemini', 'a/b?c', 'K').url.includes('?c'), 'a model name cannot add a query string');

/* ---- readers ----------------------------------------------------------- */

assert.deepStrictEqual(P.chatRead('anthropic', { model: 'claude-x', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi' }, { type: 'text', text: 'there' }] }), { text: 'Hi\nthere', model: 'claude-x', stop: 'end_turn' });
assert.deepStrictEqual(P.chatRead('openai', { model: 'gpt-x', status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'Yes' }] }] }), { text: 'Yes', model: 'gpt-x', stop: 'completed' });
assert.deepStrictEqual(P.chatRead('openai', { model: 'gpt-x', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'message', content: [{ type: 'output_text', text: 'Ye' }] }] }).stop, 'max_tokens');
assert.deepStrictEqual(P.chatRead('xai', { model: 'grok-4.7', choices: [{ finish_reason: 'stop', message: { content: 'Sure' } }] }), { text: 'Sure', model: 'grok-4.7', stop: 'stop' });
assert.deepStrictEqual(P.chatRead('gemini', { modelVersion: 'gemini-3.8-flash', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'A' }, { text: 'B' }] } }] }), { text: 'AB', model: 'gemini-3.8-flash', stop: 'STOP' });
assert.throws(() => P.chatRead('gemini', { candidates: [] }), /could not read/i, 'an empty answer is an error, not a blank bubble');
assert.throws(() => P.chatRead('gemini', { promptFeedback: { blockReason: 'SAFETY' } }), /blocked.*SAFETY/i);
assert.throws(() => P.chatRead('anthropic', { content: [] }), /could not read/i);

/* ---- failures ---------------------------------------------------------- */

assert.match(P.httpFailure('Grok', 401, null), /Grok rejected the API key.*Settings → Rhythm/);
assert.match(P.httpFailure('Gemini', 403, { error: { message: 'API key not valid' } }), /Gemini rejected the API key/);
assert.match(P.httpFailure('Claude', 404, { error: { message: 'model: nope' } }), /does not know that model.*nope/);
assert.match(P.httpFailure('ChatGPT', 429, null), /Too many requests to ChatGPT/);
assert.match(P.httpFailure('Claude', 529, null), /having trouble.*529/);
assert.match(P.httpFailure('Claude', 400, { error: { message: 'bad' } }), /Claude answered 400: bad/);

/* ---- ask(): one request, the right URL, headers and body ---------------- */

(async () => {
  const calls = [];
  const fake = json => async req => { calls.push(req); return { status: 200, json }; };

  const r1 = await P.ask({ provider: 'gemini', apiKey: 'G', system, messages, request: fake({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) });
  assert.strictEqual(r1.text, 'ok');
  const c1 = calls.pop();
  assert.strictEqual(c1.method, 'POST');
  assert.strictEqual(c1.throw, false, 'requestUrl must hand back the status, not throw');
  assert.strictEqual(c1.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent', 'the default model when none is set');
  assert.strictEqual(c1.headers['x-goog-api-key'], 'G');
  assert.strictEqual(c1.headers['content-type'], 'application/json');
  assert.deepStrictEqual(JSON.parse(c1.body).contents.length, 3);

  await P.ask({ provider: 'xai', apiKey: 'X', model: 'grok-9', system, messages, request: fake({ choices: [{ message: { content: 'ok' } }] }) });
  assert.strictEqual(JSON.parse(calls.pop().body).model, 'grok-9', 'a model set in Settings wins');

  await assert.rejects(P.ask({ provider: 'openai', apiKey: '', system, messages, request: fake({}) }), /Add your ChatGPT API key in Settings → Rhythm → Ask AI/);
  await assert.rejects(P.ask({ provider: 'anthropic', apiKey: 'K', system, messages, request: async () => ({ status: 401, json: {} }) }), /rejected the API key/);
  await assert.rejects(P.ask({ provider: 'anthropic', apiKey: 'K', system, messages, request: async () => { throw new Error('offline'); } }), /Could not reach Claude.*offline/);
  await assert.rejects(P.ask({ provider: 'anthropic', apiKey: 'K', system, messages, request: async () => ({ status: 200, text: 'not json' }) }), /could not read/i);

  /* ---- the CLIs (command lines, caps and the guard: tests/ai-cli.test.cjs) ---- */

  assert.deepStrictEqual(P.cliRead('claude-code', '{"type":"system","subtype":"init","model":"claude-opus"}\n{"type":"result","result":"Hello","is_error":false}\n'), { text: 'Hello', model: 'claude-opus', stop: '' });
  assert.throws(() => P.cliRead('claude-code', '{"type":"result","is_error":true,"result":"Please log in"}'), /not signed in/);
  assert.deepStrictEqual(P.cliRead('codex', '{"type":"item.completed","item":{"type":"agent_message","text":"Hi"}}\n'), { text: 'Hi', model: 'Codex', stop: '' });
  assert.strictEqual(P.cliRead('codex', '{"type":"item.completed","item":{"type":"agent_message","text":"I will look"}}\n{"type":"item.completed","item":{"type":"agent_message","text":"Final"}}\n').text, 'Final', 'the last message is the answer');
  assert.throws(() => P.cliRead('codex', '{"type":"turn.failed","error":{"message":"401 Unauthorized"}}'), /Codex is not signed in/);
  assert.throws(() => P.cliRead('codex', ''), /sent nothing/);

  await assert.rejects(P.ask({ provider: 'claude-code', system, messages }), /runs on a computer only/, 'a device with no runner cannot run a plan route');
  const ran = [];
  const out = await P.ask({ provider: 'claude-code', system, rules: 'RULES', page: 'PAGE TEXT', messages, run: async o => { ran.push(o); return { code: 0, stdout: '{"type":"result","result":"Fine"}', stderr: '' }; } });
  assert.strictEqual(out.text, 'Fine');
  assert.strictEqual(ran[0].id, 'claude-code');
  assert.strictEqual(ran[0].system, 'RULES', 'the command line carries the rules only');
  assert.ok(ran[0].input.includes('PAGE TEXT') && ran[0].input.includes('[User]\nWhich first?'), 'the page and the chat go on stdin');
  assert.ok(!ran[0].system.includes('PAGE TEXT'));
  await assert.rejects(P.ask({ provider: 'codex', system, messages, run: async () => ({ spawnError: { code: 'ENOENT' } }) }), /Codex wasn’t found on this computer.*set its path/);

  console.log('ai providers OK');
})().catch(e => { console.error(e); process.exit(1); });
