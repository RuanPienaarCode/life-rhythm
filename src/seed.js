'use strict';
/* Starter content written on first run when the Rhythm folder does not
   exist. Every item is a plain note the user can rename, edit or delete in
   Obsidian; the plugin never rewrites a note body it did not create.

   Areas are listed in PRIORITY order — that order is what breaks ties when
   Today has to choose what to put in front of you. */

const SEED_AREAS = [
  { name: 'Faith', order: 1, body: 'Being still. Prayer, reading, journalling, study.' },
  { name: 'Family', order: 2, body: 'Time together on purpose — meals, outings, small surprises.' },
  { name: 'People', order: 3, body: 'Community and friends — staying in touch on purpose.' },
  { name: 'Body', order: 4, body: 'Moving, sleeping, eating well.' },
  { name: 'Mind', order: 5, body: 'Reading more. Studying for myself.' },
  { name: 'Craft', order: 6, body: 'Making things with your hands — hands busy, mind quiet.' },
  { name: 'Growth', order: 7, body: 'Learning a new skill, planning ahead.' },
  { name: 'Adventure', order: 8, body: 'Getting outside. Hikes, trips, new places.' },
];

const SEED_PRACTICES = [
  { name: 'Be still', area: 'Faith', cadence: 'daily', when: 'morning', minutes: 15, body: 'Sit. Breathe. No agenda.' },
  { name: 'Read the Bible', area: 'Faith', cadence: 'daily', when: 'morning', minutes: 15, body: '' },
  { name: 'Journal', area: 'Faith', cadence: 'daily', when: 'night', minutes: 10, body: 'A few honest lines. Today\'s log note is a good place.' },
  { name: 'Pray for someone', area: 'Faith', cadence: '3/week', when: 'evening', minutes: 10, body: '' },
  { name: 'Study a passage', area: 'Faith', cadence: 'weekly', when: 'day', minutes: 45, body: 'A book, a theme, a question.' },
  { name: 'Write someone a note', area: 'Family', cadence: '2/month', when: 'evening', minutes: 20, body: '' },
  { name: 'Plan something together', area: 'Family', cadence: 'weekly', when: 'day', minutes: 10, body: 'Think of one thing. Book it or prepare it.' },
  { name: 'Screen-free evening', area: 'Family', cadence: 'weekly', when: 'evening', minutes: 60, body: 'Phones away. A game, a walk, a meal.' },
  { name: 'Message someone', area: 'People', cadence: 'daily', when: 'day', minutes: 5, body: 'One person from community or friends. Ask a real question.' },
  { name: 'Exercise', area: 'Body', cadence: '4/week', when: 'evening', minutes: 30, body: 'After work or before bed.' },
  { name: 'Read', area: 'Mind', cadence: 'daily', when: 'evening', minutes: 20, body: '' },
  { name: 'Practice an instrument', area: 'Craft', cadence: 'daily', when: 'evening', minutes: 20, body: '' },
  { name: 'Make something', area: 'Craft', cadence: 'weekly', when: 'evening', minutes: 60, body: '' },
  { name: 'Learn the new skill', area: 'Growth', cadence: '3/week', when: 'day', minutes: 45, body: 'One focused block, no scrolling.' },
  { name: 'A day outdoors', area: 'Adventure', cadence: 'monthly', when: 'day', minutes: 120, body: '' },
];

const SEED_GOALS = [
  { name: 'Walk a multi-day trail', area: 'Adventure', horizon: '2027-03', status: 'active', next: 'Choose the route', body: '' },
  { name: 'Organise a weekend hike', area: 'Adventure', horizon: '2026-11', status: 'active', next: 'Pick a weekend and message the group', body: '' },
  { name: 'Finish an online course', area: 'Growth', horizon: '2026-12', status: 'active', next: 'Choose the course', body: '' },
  { name: 'Learn a new piece of music', area: 'Craft', horizon: '2027-06', status: 'active', next: 'Choose the piece', body: '' },
];

const SEED_EVENTS = [];

module.exports = { SEED_AREAS, SEED_PRACTICES, SEED_GOALS, SEED_EVENTS };
