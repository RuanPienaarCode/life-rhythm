'use strict';
/* Audit 3 Nov 2026, H2: a deploy from the wrong checkout once silently
   removed features (and one from main would have dropped reminders
   entirely). Every build now carries its commit in a banner, and the
   deploy refuses anything that would replace the installed build with one
   that does not contain it. decide() is pure; scripts/deploy-check.mjs
   feeds it from git and the vault. */
const assert = require('node:assert');

(async () => {
  const { decide, parseStamp } = await import('../scripts/deploy-check.mjs');

  assert.deepStrictEqual(parseStamp('/* rhythm-build: 89ab868 feat/ask-ai 2026-11-03 */\n"use strict";'), { sha: '89ab868', dirty: false, branch: 'feat/ask-ai' });
  assert.deepStrictEqual(parseStamp('/* rhythm-build: 89ab868-dirty feat/ask-ai 2026-11-03 */'), { sha: '89ab868', dirty: true, branch: 'feat/ask-ai' });
  assert.strictEqual(parseStamp('"use strict";\nvar x = 1;'), null, 'an older build has no stamp');
  assert.strictEqual(parseStamp(''), null);

  const base = { dirty: false, head: 'aaa1111', built: { sha: 'aaa1111', dirty: false }, installed: { sha: 'bbb2222', dirty: false }, isAncestor: true, allow: {} };
  const ok = o => decide(Object.assign({}, base, o));

  assert.deepStrictEqual(ok({}), { ok: true, why: [] }, 'HEAD contains what is installed: go');
  assert.ok(!ok({ dirty: true }).ok, 'uncommitted changes: no deploy (nothing would say what was installed)');
  assert.ok(!ok({ built: { sha: 'ccc3333', dirty: false } }).ok, 'main.js was built from another commit: rebuild first');
  assert.ok(!ok({ built: null }).ok, 'an unstamped main.js is never deployed');
  assert.ok(!ok({ built: { sha: 'aaa1111', dirty: true } }).ok, 'a build of a dirty tree is never deployed');

  const down = ok({ isAncestor: false });
  assert.ok(!down.ok, 'the installed build is not in HEAD\'s history: this would remove work');
  assert.ok(/bbb2222/.test(down.why.join(' ')), 'it names the installed commit');
  assert.ok(ok({ isAncestor: false, allow: { downgrade: true } }).ok, 'RHYTHM_ALLOW_DOWNGRADE=1 says it on purpose');

  assert.ok(!ok({ installed: null }).ok, 'an unstamped installed build: cannot prove nothing is lost');
  assert.ok(ok({ installed: null, allow: { unstamped: true } }).ok, 'RHYTHM_ALLOW_UNSTAMPED=1 for the first stamped deploy');
  assert.ok(ok({ installed: 'none' }).ok, 'nothing installed yet: go');
  assert.ok(!ok({ installed: { sha: 'bbb2222', dirty: true } }).ok, 'the installed build came from uncommitted work: say so first');
  assert.ok(ok({ installed: { sha: 'bbb2222', dirty: true }, allow: { downgrade: true } }).ok);

  console.log('deploy check OK');
})().catch(e => { console.error(e); process.exit(1); });
