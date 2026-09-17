# Rhythm

A quiet dashboard for life priorities, practices, goals and events, kept as plain notes in your Obsidian vault. Daily, weekly and monthly rhythms. Works offline, on desktop and mobile. Styled after Apple's own apps: a large title, inset grouped lists, one blue.

The one rule: **the list you look at is short and varied.** Today shows a few things (three by default). Every life area gets a turn before any area gets a second slot, so a day reads Faith, Family, Body rather than three Faith rows. Everything else that is due folds away under "When there's space".

## Pages

- **Today** — a large number, the few practices to do grouped by time of day (morning, during the day, evening, before bed), each with a plain reason it is there ("2 more this week · 3 days left", "Missed 3 days"), a fold for the rest, what you've done, what you said no to, events in the next seven days, one goal's next step, and the first line of today's note. When the list is clear, a line of scripture or a stillness prompt. Arrows step back and forward a day.
- **Week** — two-line rows per practice with seven dots you can tap, grouped by area. On the last day of the week, or on any past week, a "Week in review" card: what got done against what was asked, what slipped, and one question whose answer is saved into that day's note.
- **Month** — every practice against its monthly target, all goals (a goal without a next step is flagged), the month's events.
- **Plan** — a board. A shelf of the practices still looking for a day, and seven day columns to drop them on. Drag a card by its grip, or tap it for a "Move to…" menu. A practice you have placed stays quiet on every other day, so a week of four runs becomes four calm days instead of seven noisy ones. Only weekly and monthly practices reach the board; a daily one has no *when* to decide, so it sits under each column as a quiet count.
- **Areas** — your life areas in priority order, and the page where you shape the list rather than work it. Tap an area to see its own practices, each showing when it was last actually done, with anything cold marked. **Set aside** takes a practice out of the asking without deleting it; it keeps its note and its whole history and sits in a "Set aside" group with a one-tap **Bring back**. Move areas up and down from the arrows or the menu.

### One at a time

When more than one thing is outstanding, Today offers a **List / One at a time** switch. The deck shows everything outstanding as a stack of cards, the front one live and the rest peeking out behind it. Swipe it up for done, left for not today, right for later today, or use the four buttons: **Not today**, **Done**, **Later today**, and **Another day**, which names one of the next seven and hands the card to it. "Show me another" flips through without deciding anything. Fourteen things in a list ask you to weigh fourteen things at once; the deck asks one question at a time. Set the default under Settings → Today shows.

Every practice row has a **…** menu: *Not today* (does not count, does not nag), *Later today* (quiet for the rest of today only), *Another day* (a promise to a named day, which is the same thing the Plan board writes), *Edit* and *Open note*. Anything promised to another day leaves today's list and is accounted for under a "Planned for another day" fold, so nothing disappears without a trace. Ticks show an **Undo** toast for five seconds. Tapping a goal's next step asks for the next one.

The **+** button adds a practice, goal, event or area. Its first field is a quick line: `Practice guitar daily 20min @evening #Craft` or `Date night 2026-09-14 19:00 #Family` or `Get my licence by 2027-03 #Adventure` fills the form as you type.

**Keyboard (desktop):** `1`–`7` tick the focus rows, `←` `→` move the date, `T` returns to today, `N` adds.

**On a phone** the tabs sit at the bottom, in thumb reach.

## The notes

Everything lives under a `Rhythm/` folder (change it in settings). Each item is a markdown note; the plugin reads frontmatter and never rewrites a note body it did not create. It only appends (a weekly review, a completed goal step). Edit them by hand whenever you like.

```
Rhythm/
  Areas/      one note per life area          rhythm: area,  order: 1
  Practices/  things you keep a rhythm with   rhythm: practice, area, cadence, when, minutes, days, status
  Goals/      outcomes with a horizon         rhythm: goal, area, horizon, status, next
  Events/     dated things                    rhythm: event, area, date, time
  Log/        one note per day                rhythm: log, done: [...], skip: [...], snooze: [...], plan: [...]
```

`cadence` accepts `daily`, `weekly`, `monthly`, `3/week`, `2x/week`, `2/month`, `4 per week`. A `days: [sat, sun]` list narrows a daily practice to those weekdays. `when` is `morning`, `day`, `evening` or `night`, and an optional `time: "05:30"` pins the hour and orders the day. `status: aside` takes a practice out of the asking (`paused` is the older spelling and still works); `status: done` retires a goal. A goal `horizon` is `YYYY-MM` or `YYYY-MM-DD`.

`plan` is the Plan board's promise: the practice named there is asked for on that day and stays quiet before it. A tick clears the day's plan, skip and snooze together.

The day's log note body is yours for journalling. Its first line shows on Today.

## Writing

The **Write in this day's note** link at the foot of Today opens a small composer: a title, a body, and seven marks worth a button — bold, italic, heading, bullet list, task, quote and link. `Cmd`/`Ctrl` with `B`, `I` or `K` does the same from the keyboard, and `Cmd`/`Ctrl`+`Enter` saves.

Every button toggles: press bold on bold text and it comes off, press bullet on a task list and it becomes a plain list rather than growing a second marker. A selection that catches the trailing line break is pulled back before the markers go on, so you never end up with a marker straddling a newline.

A title becomes a `## heading`; without one you just get the words. It only ever **appends** to the day's note, which is what lets it exist at all: the plugin's standing rule is that it never rewrites prose a person typed. "Open the note" is one tap away for everything the box cannot do.

## Calendar in

Settings → Subscribed calendars takes ICS links, one per line. In Apple Calendar: right-click a calendar → Share → Public Calendar and copy the webcal link. Events show under "Coming up" and on the Month page, refreshed every six hours and cached so the page never waits on the network. Recurring events (daily, weekly with days, monthly, yearly, with count/until/exceptions) are expanded four months ahead.

## Reminders out

Obsidian cannot schedule notifications. The plugin registers `obsidian://rhythm?tab=today`; a Shortcuts automation on iPhone ("At 7:00 → Open URL") or a home-screen bookmark opens Rhythm at a set time. Settings and the command palette both have "Copy link".

## Accent

Settings → Accent. Ten muted presets — Slate `#386382`, Sage `#6A9B85`, Teal, Clay, Rose, Plum, Ochre, Moss, Ink and Apple's system blue — plus a field for any hex of your own.

One colour does all the work: ticks, links, today, the progress rails. A single hex cannot do that alone, so each choice is expanded into three values per theme: a **fill** for solid things (3:1 against the surface, WCAG's bar for a graphical object), a **text** variant taken far enough for 4.5:1 as words, and the black or white **ink** that sits on the fill. A colour that already clears a bar is used exactly as given; only the ones that need it are nudged, and only as far as they must go. `tests/accents.test.cjs` asserts every preset clears all six bars in both themes, so a colour cannot be added by taste alone.

## Background

Settings → Background. Five built-in gradients, or any photograph you drop into `Rhythm/Backgrounds/` — JPG, PNG, WEBP, AVIF, GIF and SVG are all read, and images resolve through the vault's own resource path so they work on desktop and phone alike. The plugin ships no pictures of its own; a plugin has no business carrying megabytes of JPEG, and your own photographs are better than anything that could be bundled.

With a wallpaper showing, the surfaces become frosted glass: every card, the hero, the deck and the board blur what is behind them, and section labels take a small glass chip of their own.

The hard part is not the image, it is the reading. A photograph is an arbitrary field of light, so type laid over one is legible by luck. Two things fix that. A **veil** over the whole picture pins the ground to a known lightness, and that is the **Veil** slider — a bright photograph needs more of it than a dark one, and it is the control to reach for if anything is hard to read. **Glass** does the rest, so no edge of the picture cuts through a line of type. Where `backdrop-filter` is unavailable the panels go nearly opaque instead, since a flat wash over a sharp photograph is the one combination that cannot be read.

## Streak

Settings → Streak: days in a row, good weeks in a row (a week counts when at least 60% of what was asked got done, so one sick day does not reset you), or off.

## First run

Opening Rhythm in a vault with no `Rhythm/` folder shows a setup card: start with the starter set (eight areas, fifteen practices, four goals) or start empty.

## Develop

```bash
./build.sh            # bundle src/ → main.js, copy styles, run the guard suite
./scripts/deploy.sh   # copy main.js, styles.css, manifest.json into the vault and prove it by sha256
npm run preview       # build the browser harness; serve the repo and open _preview/preview.html?seeded=1
```

Root `main.js` and `styles.css` are build output; edit `src/` only. The bundle targets Safari 15 because Obsidian mobile runs the OS WebView: no lookbehind regex, no Node APIs, no innerHTML (all test-gated). Ten design directions live in `design/` with `design/index.html` as the overview; the shipped one is 07 Apple.

## Licence

AGPL-3.0-only.
