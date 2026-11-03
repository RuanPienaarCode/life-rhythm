'use strict';
/* Ask AI: every AI the chat can talk to, behind one ask(). Each answers in
   the same shape, { text, model, stop }.

   Two kinds:
     api  Claude (Anthropic), ChatGPT (OpenAI), Grok (xAI), Gemini (Google)
          — over Obsidian's requestUrl with the person's own key, kept on
          this device only (src/ai/host.js), never in the vault.
     cli  Claude Code, Codex — the person's own app on a computer, signed in
          to their Claude or ChatGPT plan, run by src/ai/cli.js in an empty
          temp folder. Claude Code gets no tools at all (--tools ""): it
          cannot read files, run commands or browse. Codex has no switch for
          that: its read-only sandbox stops writes and network, but it can
          still read files on the computer — Settings says so.

   Pure: no DOM, no Node. Requests and runs are passed in, so
   tests/ai-providers.test.cjs pins every body, header and reader.
   The CLI pieces follow Find a Deal's src/providers.js. */

const PROVIDERS = [
  { id: 'anthropic', name: 'Claude', kind: 'api', model: 'claude-sonnet-5-5', keyHint: 'sk-ant-…', console: 'console.anthropic.com' },
  { id: 'openai', name: 'ChatGPT', kind: 'api', model: 'gpt-5.5', keyHint: 'sk-…', console: 'platform.openai.com' },
  { id: 'xai', name: 'Grok', kind: 'api', model: 'grok-4.7', keyHint: 'xai-…', console: 'console.x.ai' },
  { id: 'gemini', name: 'Gemini', kind: 'api', model: 'gemini-flash-latest', keyHint: 'AIza…', console: 'aistudio.google.com' },
  { id: 'claude-code', name: 'Claude Code', kind: 'cli', bin: 'claude', model: '', plan: 'Claude' },
  { id: 'codex', name: 'Codex', kind: 'cli', bin: 'codex', model: '', plan: 'ChatGPT' },
];

const provider = id => PROVIDERS.find(p => p.id === id) || PROVIDERS[0];

const MAX_TOKENS = 2000;

/* ---- the APIs -------------------------------------------------------------- */

/* messages: [{ role: 'user' | 'assistant', content: string }] */
function chatBody(id, o) {
  const messages = o.messages.map(m => ({ role: m.role, content: m.content }));
  if (id === 'openai') return { model: o.model, instructions: o.system, input: messages, max_output_tokens: MAX_TOKENS };
  if (id === 'xai') return { model: o.model, max_tokens: MAX_TOKENS, messages: [{ role: 'system', content: o.system }, ...messages] };
  if (id === 'gemini') {
    return {
      systemInstruction: { parts: [{ text: o.system }] },
      contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: MAX_TOKENS },
    };
  }
  return { model: o.model, max_tokens: MAX_TOKENS, system: o.system, messages };
}

/* Where each API lives, and the header its key goes in. Gemini's key goes
   in a header too, so it never sits in a URL. */
function endpoint(id, model, key) {
  if (id === 'openai') return { url: 'https://api.openai.com/v1/responses', headers: { Authorization: `Bearer ${key}` } };
  if (id === 'xai') return { url: 'https://api.x.ai/v1/chat/completions', headers: { Authorization: `Bearer ${key}` } };
  if (id === 'gemini') return { url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, headers: { 'x-goog-api-key': key } };
  return { url: 'https://api.anthropic.com/v1/messages', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } };
}

function unreadable(name) { return new Error(`${name} sent an answer Rhythm could not read.`); }

function chatRead(id, json) {
  const name = provider(id).name;
  if (!json || typeof json !== 'object') throw unreadable(name);
  let text = '', model = '', stop = '';
  if (id === 'openai') {
    for (const item of json.output || []) {
      if (item && item.type === 'message') for (const c of item.content || []) if (c && c.type === 'output_text') text += c.text || '';
    }
    model = json.model || '';
    stop = json.status === 'incomplete' && json.incomplete_details && json.incomplete_details.reason === 'max_output_tokens' ? 'max_tokens' : (json.status || '');
  } else if (id === 'xai') {
    const choice = (json.choices || [])[0] || {};
    text = String((choice.message && choice.message.content) || '');
    model = json.model || '';
    stop = choice.finish_reason === 'length' ? 'max_tokens' : (choice.finish_reason || '');
  } else if (id === 'gemini') {
    if (json.promptFeedback && json.promptFeedback.blockReason) throw new Error(`Gemini blocked that question (${json.promptFeedback.blockReason}).`);
    const cand = (json.candidates || [])[0] || {};
    text = ((cand.content && cand.content.parts) || []).map(p => p.text || '').join('');
    model = json.modelVersion || '';
    stop = cand.finishReason === 'MAX_TOKENS' ? 'max_tokens' : (cand.finishReason || '');
  } else {
    text = (json.content || []).filter(b => b && b.type === 'text').map(b => b.text || '').join('\n');
    model = json.model || '';
    stop = json.stop_reason || '';
  }
  if (!text.trim()) throw unreadable(name);
  return { text, model, stop };
}

/* What a failed call says. */
function httpFailure(name, status, body) {
  const msg = body && body.error && body.error.message ? String(body.error.message) : '';
  if (status === 401 || (status === 403 && /key/i.test(msg))) return `${name} rejected the API key. Check it in Settings → Rhythm → Ask AI.`;
  if (status === 404) return `${name} does not know that model. Check the model name in Settings → Rhythm → Ask AI. ${msg}`.trim();
  if (status === 429) return `Too many requests to ${name} right now — wait a minute and ask again.`;
  if (status >= 500) return `${name} is having trouble right now (${status}) — try again in a few minutes.`;
  return `${name} answered ${status}${msg ? ': ' + msg : ''}.`;
}

async function askApi(p, o) {
  if (!o.apiKey) throw new Error(`Add your ${p.name} API key in Settings → Rhythm → Ask AI.`);
  const model = o.model || p.model;
  const { url, headers } = endpoint(p.id, model, o.apiKey);
  let res;
  try {
    res = await o.request({ url, method: 'POST', contentType: 'application/json', throw: false, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(chatBody(p.id, { system: o.system, messages: o.messages, model })) });
  } catch (e) {
    throw new Error(`Could not reach ${p.name} — check your connection. ${String((e && e.message) || e)}`);
  }
  let json = null;
  try { json = res.json !== undefined ? res.json : JSON.parse(res.text); } catch (e) { json = null; }
  if (res.status !== 200) throw new Error(httpFailure(p.name, res.status, json));
  return chatRead(p.id, json);
}

/* ---- the CLIs -------------------------------------------------------------- */

/* One run per turn: the earlier turns ride along in the prompt. Codex has
   no system-prompt flag, so the rules lead its prompt. */
function cliPrompt(id, o) {
  const turns = o.messages.slice(0, -1).map(m => `${m.role === 'assistant' ? 'AI' : 'You'}: ${m.content}`);
  const last = o.messages[o.messages.length - 1];
  const parts = [];
  if (id === 'codex') parts.push(o.system);
  if (turns.length) parts.push('Conversation so far:\n' + turns.join('\n\n'));
  parts.push(last ? last.content : '');
  return parts.join('\n\n');
}

function cliArgs(id, o) {
  if (id === 'codex') {
    const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only'];
    if (o.model) args.push('-m', o.model);
    args.push('-');
    return args;
  }
  const args = ['-p', '--output-format', 'stream-json', '--verbose',
    '--tools', '', '--permission-mode', 'dontAsk',
    '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence',
    '--system-prompt', o.system];
  if (o.model) args.push('--model', o.model);
  return args;
}

const jsonLines = stdout => String(stdout || '').split(/\r?\n/).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(x => x && typeof x === 'object');

function cliRead(id, stdout) {
  if (id === 'codex') {
    const texts = [];
    for (const e of jsonLines(stdout)) {
      if (e.type === 'turn.failed' || e.type === 'error') {
        const why = String((e.error && e.error.message) || e.message || 'unknown error');
        if (/not logged in|log ?in|sign in|unauthori[sz]ed|401/i.test(why)) throw new Error('Codex is not signed in. Open Terminal, run codex login, then ask again.');
        throw new Error(`Codex stopped: ${why}`);
      }
      if (e.type === 'item.completed' && e.item && e.item.type === 'agent_message') texts.push(String(e.item.text || ''));
    }
    if (!texts.length) throw new Error('Codex sent nothing Rhythm could read.');
    return { text: texts.join('\n'), model: 'Codex', stop: '' };
  }
  let model = '', result = null;
  for (const e of jsonLines(stdout)) {
    if (e.type === 'system' && e.subtype === 'init' && e.model) model = e.model;
    if (e.type === 'result') result = e;
  }
  if (!result) throw new Error('Claude Code sent nothing Rhythm could read.');
  if (result.is_error) {
    const why = String(result.result || '');
    if (/login|log in|sign in|api key|auth/i.test(why)) throw new Error('Claude Code is not signed in. Open Terminal, run claude and sign in, then ask again.');
    throw new Error(`Claude Code stopped: ${why || result.subtype || 'unknown error'}`);
  }
  return { text: String(result.result || ''), model: model || 'Claude Code', stop: result.stop_reason || '' };
}

async function askCli(p, o) {
  if (typeof o.run !== 'function') throw new Error(`${p.name} runs on a computer only (it uses the ${p.bin} app signed in to your ${p.plan} plan). Pick Claude, ChatGPT, Grok or Gemini for this device in Settings → Rhythm → Ask AI.`);
  let res;
  try {
    res = await o.run(p.bin, cliArgs(p.id, o), { stdin: cliPrompt(p.id, o), timeoutMs: o.timeoutMs });
  } catch (e) {
    if (e && e.code === 'ENOENT') throw new Error(`Could not find ${p.name} (${p.bin}). Install it, or set its path in Settings → Rhythm → Ask AI.`);
    if (e && e.code === 'TIMEOUT') throw new Error(`${p.name} took longer than ${Math.max(1, Math.round((o.timeoutMs || 0) / 60000))} minutes and was stopped.`);
    throw new Error(`${p.name} could not start: ${String((e && e.message) || e)}`);
  }
  try {
    return cliRead(p.id, res.stdout);
  } catch (e) {
    const tail = String(res.stderr || '').trim().split(/\r?\n/).filter(Boolean).pop();
    if (res.code !== 0 && tail && /sent nothing/.test(e.message)) throw new Error(`${p.name} stopped: ${tail}`);
    throw e;
  }
}

/* ---- one way in ------------------------------------------------------------ */

/* o: { provider, system, messages, model, apiKey, request (api),
        run + timeoutMs (cli) } → { text, model, stop } */
function ask(o) {
  const p = provider(o.provider);
  return p.kind === 'cli' ? askCli(p, o) : askApi(p, o);
}

module.exports = { PROVIDERS, provider, chatBody, endpoint, chatRead, httpFailure, cliArgs, cliPrompt, cliRead, ask, MAX_TOKENS };
