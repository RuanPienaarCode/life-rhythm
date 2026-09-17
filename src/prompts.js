'use strict';
/* What the page says when the list is clear: a short line of scripture
   (World English Bible, public domain) or a stillness prompt, chosen by
   the date so the same day shows the same line. */

const LINES = [
  { text: 'Be still, and know that I am God.', ref: 'Psalm 46:10' },
  { text: 'In quietness and in confidence shall be your strength.', ref: 'Isaiah 30:15' },
  { text: 'Come to me, all you who labor and are heavily burdened, and I will give you rest.', ref: 'Matthew 11:28' },
  { text: 'The Lord is my shepherd: I shall lack nothing. He makes me lie down in green pastures.', ref: 'Psalm 23:1–2' },
  { text: 'My soul, wait in silence for God alone, for my expectation is from him.', ref: 'Psalm 62:5' },
  { text: 'This is the day that the Lord has made. We will rejoice and be glad in it.', ref: 'Psalm 118:24' },
  { text: 'Cast all your worries on him, because he cares for you.', ref: '1 Peter 5:7' },
  { text: 'Peace I leave with you. My peace I give to you.', ref: 'John 14:27' },
  { text: 'Sit for a minute with nothing in your hands.' },
  { text: 'Pick up the guitar. Play one thing slowly.' },
  { text: 'Breathe out longer than you breathe in. Three times.' },
  { text: 'Write one line in today\'s note about what you noticed.' },
  { text: 'Text her something you like about her.' },
  { text: 'Step outside for two minutes. Look at the far distance.' },
];

function promptFor(iso) {
  let h = 0;
  for (const ch of String(iso || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LINES[h % LINES.length];
}

module.exports = { promptFor, LINES };
