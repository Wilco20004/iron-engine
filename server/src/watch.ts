import crypto from 'crypto';
import path from 'path';
import { NextFunction, Request, Response, Router } from 'express';
import { db, ProfileRow } from './db';
import { Plan, Workout, goalSets, goalText, groupOf, setsFor, slug, suggestNext, workoutsFor } from './plan';
import { blockEntries, blockPlan, currentWeek, ensureBlock, lastSets, library, putEntry, weekStatus } from './store';

// API for the Garmin watch app (watch/ in this repo). The watch can't sign in,
// so each person has a watch key, sent as the X-Watch-Key header (or ?key=).
// Responses are compact and ASCII-only because watch fonts lack many glyphs.
// "day" in requests and responses is the workout's position in that week.

type Entry = Record<string, any>;

export function watchKey(profileId: string): string {
  const row = db.prepare('SELECT watch_key FROM profiles WHERE id = ?').get(profileId) as { watch_key: string | null };
  return row.watch_key ?? regenerateWatchKey(profileId);
}

export function regenerateWatchKey(profileId: string): string {
  const key = crypto.randomBytes(9).toString('base64url');
  db.prepare('UPDATE profiles SET watch_key = ? WHERE id = ?').run(key, profileId);
  return key;
}

const ascii = (s: string) => s.replace(/[–—]/g, '-').replace(/×/g, 'x').replace(/[^\x20-\x7E]/g, '').trim();
const restSecs = (txt: string) => { const n = parseFloat(txt); return Math.round(/min/.test(txt) ? n * 60 : n) || 60; };

function cardioFor(plan: Plan, day: Workout, wk: Plan['weeks'][number]) {
  if (wk.cardio !== 'deload') return { kind: day.cardio.kind, phases: day.cardio.phases };
  const m = plan.deloadCardio?.minutes ?? 15;
  return { kind: 'Easy ' + day.cardio.kind.replace(/ intervals?/i, '').toLowerCase(), phases: [['Steady Zone 2', m * 60, 'steady']] };
}

function loadLabel(name: string) {
  switch (library()[name]?.load) {
    case 'barbell': case 'ezbar': return 'total kg';
    case 'dumbbell': return 'kg each';
    case 'added': return 'added kg';
    case 'time': return 'seconds';
    case 'bodyweight': return 'bodyweight';
    default: return 'kg';
  }
}

// This calendar week's next workout that isn't done or skipped, or a specific
// one with week and day. weekDone: everything this week is done (or skipped).
function session(p: ProfileRow, week?: number, day?: number) {
  const block = ensureBlock(p);
  const plan = blockPlan(block);
  const entries = blockEntries(p.id, block.id) as Record<string, Entry>;
  const now = currentWeek(block, plan);
  let w = now.week, d = -1, weekDone = false;
  const status = weekStatus(block, plan, entries, w);
  if (week !== undefined && day !== undefined && plan.weeks[week] && workoutsFor(plan, week)[day]) {
    w = week; d = day;
  } else {
    d = status.find(s => s.status === 'started' || s.status === 'todo')?.index ?? -1;
    if (d < 0) { weekDone = true; d = Math.max(0, status.findIndex(s => s.status !== 'skipped')); }
  }
  const wk = plan.weeks[w], tday = workoutsFor(plan, w)[d];
  const lib = library();
  const shown = w === now.week ? status : weekStatus(block, plan, entries, w);
  return {
    person: ascii(p.name), block: block.number, blockDone: now.finished, weekDone,
    week: w, day: d, weekName: ascii(wk.name), rir: wk.rir,
    title: ascii(tday.title),
    lifts: tday.lifts.map(l => {
      const e = entries[`${w}-${d}-${slug(l.name)}`];
      const info = lib[l.name];
      const last = lastSets(p.id, block, entries, l.name, w, d);
      const next = suggestNext(l, info?.load as string | undefined, last?.sets ?? null, wk);
      return {
        name: ascii(l.name).slice(0, 40),
        sets: setsFor(l, wk),
        reps: ascii(l.reps),
        repT: parseInt(next.reps, 10) || parseInt(l.reps, 10) || 10,
        rest: restSecs(l.rest),
        load: loadLabel(l.name),
        kg: next.kg,
        tip: ascii(next.why).slice(0, 40),
        // Supersets: lifts with the same group letter are done back to back.
        group: groupOf(l) ?? '', pair: l.pair ?? '',
        goal: l.goal ? ascii(goalText(l.goal)) : '',
        goalMet: !!(l.goal && last && goalSets(l.goal, last.sets) >= l.goal.sets),
        logged: ((e?.sets as Entry[] | undefined) ?? []).filter(s => s.done).map(s => ({ kg: s.kg ?? '', reps: s.reps ?? '', fail: !!s.fail, sec: Number(s.sec) || 0, hr: Number(s.hr) || 0 })),
        // For the watch's info and photo pages; photos come from /watch/photo/<photo>-<n>.jpg.
        what: ascii(String(info?.what ?? '')).slice(0, 160),
        steps: ((info?.steps ?? []) as string[]).slice(0, 8).map(s => ascii(s).slice(0, 120)),
        photo: info?.photo && info.images ? String(info.photo) : '',
      };
    }),
    cardio: { ...cardioFor(plan, tday, wk), done: !!entries[`${w}-${d}-cardio`]?.done },
    // This week's other workouts, for "Other workout" on the watch.
    week_sessions: shown.filter(s => s.status !== 'skipped').map(s => ({ day: s.index, title: ascii(s.title), done: s.status === 'done' })),
  };
}

function meta(plan: Plan, w: number, d: number, item: string): Entry {
  return { week: plan.weeks[w].name, workout: workoutsFor(plan, w)[d].title, item, date: new Date().toISOString().slice(0, 10) };
}

function authWatch(req: Request, res: Response, next: NextFunction) {
  const key = (req.headers['x-watch-key'] as string) || (req.query.key as string) || '';
  const p = key ? db.prepare('SELECT * FROM profiles WHERE watch_key = ?').get(key) as ProfileRow | undefined : undefined;
  if (!p) return res.status(401).json({ error: 'Unknown watch key' });
  res.locals.profile = p;
  next();
}

// A watch that still shows an earlier block (saved while offline) sends that
// block's number; its week/day positions mean nothing in the current block.
const otherBlock = (b: unknown, current: number) => b !== undefined && b !== null && b !== '' && +(b as string) !== current;

const int = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number.isInteger(+(v as string)) ? +(v as string) : NaN);

export const watch = Router();
watch.use(authWatch);

// The next unfinished session, or a specific one with ?week=&day=.
watch.get('/session', (req, res) => {
  let w = int(req.query.week), d = int(req.query.day);
  if (Number.isNaN(w) || Number.isNaN(d)) return res.status(400).json({ error: 'week and day must be numbers' });
  if (otherBlock(req.query.block, ensureBlock(res.locals.profile).number)) w = d = undefined;
  res.json(session(res.locals.profile, w, d));
});

// Exercise photos (start -0, finish -1) for the watch, behind the watch key so
// they come through the same proxy location as the rest of /watch.
const photoDir = path.join(__dirname, '..', '..', 'web', 'dist', 'exercises');
watch.get('/photo/:file', (req, res) => {
  if (!/^[A-Za-z0-9_-]+-[01]\.jpg$/.test(req.params.file)) return res.status(404).json({ error: 'No such photo' });
  res.sendFile(path.join(photoDir, req.params.file), err => {
    if (err && !res.headersSent) res.status(404).json({ error: 'No such photo' });
  });
});

// One finished set: { week, day, lift (index), set (index), kg, reps, fail, sec, hr }.
// sec = how long the set took, hr = peak heart rate during it (both optional).
watch.post('/set', (req, res) => {
  const p = res.locals.profile as ProfileRow;
  const { week, day, lift, set, kg, reps, fail, sec, hr } = req.body ?? {};
  const block = ensureBlock(p);
  const plan = blockPlan(block);
  if (otherBlock(req.body?.block, block.number)) return res.status(400).json({ error: 'That was logged in an earlier block' });
  const tday = plan.weeks[week] ? workoutsFor(plan, week)[day] : undefined;
  if (!tday || !tday.lifts[lift] || !(Number.isInteger(set) && set >= 0 && set < 12)) {
    return res.status(400).json({ error: 'No such exercise or set in your current plan' });
  }
  const l = tday.lifts[lift], key = `${week}-${day}-${slug(l.name)}`;
  const entries = blockEntries(p.id, block.id) as Record<string, Entry>;
  const e: Entry = entries[key] ?? meta(plan, week, day, l.name);
  const target = setsFor(l, plan.weeks[week]);
  e.sets = (e.sets as Entry[] | undefined) ?? [];
  while (e.sets.length < Math.max(target, set + 1)) e.sets.push({ kg: '', reps: '', done: false });
  const metric = (v: unknown, max: number) => { const n = int(v); return n !== undefined && !Number.isNaN(n) && n > 0 && n < max ? String(n) : undefined; };
  const s = metric(sec, 3600), h = metric(hr, 250);
  e.sets[set] = { kg: String(kg ?? ''), reps: String(reps ?? ''), done: true, ...(fail ? { fail: true } : {}), ...(s ? { sec: s } : {}), ...(h ? { hr: h } : {}) };
  e.done = e.sets.filter((s: Entry) => s.done).length >= target;
  putEntry(p.id, block.id, key, e);
  res.json({ ok: true, done: e.done });
});

// Cardio finished: { week, day, min }.
watch.post('/cardio', (req, res) => {
  const p = res.locals.profile as ProfileRow;
  const { week, day, min } = req.body ?? {};
  const block = ensureBlock(p);
  const plan = blockPlan(block);
  if (otherBlock(req.body?.block, block.number)) return res.status(400).json({ error: 'That was logged in an earlier block' });
  const tday = plan.weeks[week] ? workoutsFor(plan, week)[day] : undefined;
  if (!tday) return res.status(400).json({ error: 'No such session in your current plan' });
  const key = `${week}-${day}-cardio`;
  const e: Entry = (blockEntries(p.id, block.id) as Record<string, Entry>)[key] ?? meta(plan, week, day, 'Cardio: ' + tday.cardio.kind);
  if (min !== undefined && min !== null && min !== '') e.min = String(min);
  e.done = true;
  putEntry(p.id, block.id, key, e);
  res.json({ ok: true });
});

// The Garmin activity the watch recorded for a session: { week, day, min, avgHr, maxHr, kcal }.
watch.post('/workout', (req, res) => {
  const p = res.locals.profile as ProfileRow;
  const { week, day } = req.body ?? {};
  const block = ensureBlock(p);
  const plan = blockPlan(block);
  if (otherBlock(req.body?.block, block.number)) return res.status(400).json({ error: 'That was logged in an earlier block' });
  const tday = plan.weeks[week] ? workoutsFor(plan, week)[day] : undefined;
  if (!tday) return res.status(400).json({ error: 'No such session in your current plan' });
  const key = `${week}-${day}-watch`;
  const e: Entry = (blockEntries(p.id, block.id) as Record<string, Entry>)[key] ?? meta(plan, week, day, 'Garmin activity');
  for (const f of ['min', 'avgHr', 'maxHr', 'kcal'] as const) {
    const v = int(req.body[f]);
    if (v !== undefined && !Number.isNaN(v) && v >= 0 && v < 10000) e[f] = String(v);
  }
  putEntry(p.id, block.id, key, e);
  res.json({ ok: true });
});
