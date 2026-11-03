'use strict';
/* Which build this is — "<commit>[-dirty] <branch> <date>", set by
   esbuild.config.mjs (define RHYTHM_BUILD). The preview harness and the
   tests run src/ unbundled, where it is "dev". */
/* global RHYTHM_BUILD */
const BUILD = typeof RHYTHM_BUILD !== 'undefined' ? RHYTHM_BUILD : 'dev';

module.exports = { BUILD };
