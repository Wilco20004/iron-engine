import crypto from 'crypto';
import path from 'path';
import { NextFunction, Request, Response, Router } from 'express';
import { db, ProfileRow } from './db';
import { Plan, parseKey, slug } from './plan';
import { blockEntries, blockPlan, ensureBlock, listBlocks, library, putEntry } from './store';

// API for the Garmin watch app (watch/ in this repo). The watch can't sign in,
// so each person has a watch key, sent as the X-Watch-Key header (or ?key=).
// Responses are compact and ASCII-only because watch fonts lack many glyphs.

type Entry = Record<string, any>;
type TrainingDay = Extract<Plan['days'][number], { lifts: unknown }>;

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
const setsFor = (lift: TrainingDay['lifts'][number], wk: Plan['weeks'][number]) =>
  Math.max(1, Math.round((lift.sets + (lift.main ? wk.extraSets : 0)) * wk.setScale));
const isTraining = (d: Plan['days'][number]): d is TrainingDay => 'lifts' in d;

function cardioFor(plan: Plan, day: TrainingDay, wk: Plan['weeks'][number]) {
  if (wk.cardio !== 'deload') return { kind: day.cardio.kind, phases: day.cardio.phases };
  const m = plan.deloadCardio?.minutes ?? 15;
  return { kind: 'Easy ' + day.cardio.kind.replace(/ intervals?/i, '').toLowerCase(), phases: [['Steady Zone 2', m * 60, 'steady']] };
}

function sessionDone(plan: Plan, entries: Record<string, Entry>, w: number, d: number) {
  const day = plan.days[d];
  if (!isTraining(day)) return true;
  if (entries[`${w}-${d}-end`] || entries[`${w}-${d}-cardio`]?.done) return true;
  return day.lifts.every(l => entries[`${w}-${d}-${slug(l.name)}`]?.done);
}

// Last weight used for an exercise: earlier weeks of this block, else the
// previous block's last non-recovery week.
function suggestKg(profileId: string, blockNumber: number, plan: Plan, entries: Record<string, Entry>, week: number, name: string): string {
  const s = slug(name);
  const firstKg = (e?: Entry) => (e?.sets as Entry[] | undefined)?.find(x => x.done && x.kg)?.kg as string | undefined;
  for (let w = week - 1; w >= 0; w--) {
    for (const [k, e] of Object.entries(entries)) {
      const p = parseKey(k);
      if (p && p.week === w && p.item === s && firstKg(e)) return firstKg(e)!;
    }
  }
  const prev = listBlocks(profileId).find(b => b.number === blockNumber - 1);
  if (!prev) return '';
  const prevPlan = blockPlan(prev);
  let best: { w: number; kg: string } | null = null;
  for (const [k, e] of Object.entries(blockEntries(profileId, prev.id))) {
    const p = parseKey(k);
    if (!p || p.item !== s || prevPlan.weeks[p.week]?.cardio === 'deload') continue;
    const kg = firstKg(e);
    if (kg && (!best || p.week > best.w)) best = { w: p.week, kg };
  }
  return best?.kg ?? '';
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

function session(p: ProfileRow, week?: number, day?: number) {
  const block = ensureBlock(p);
  const plan = blockPlan(block);
  const entries = blockEntries(p.id, block.id) as Record<string, Entry>;
  let w = week, d = day, blockDone = false;
  if (w === undefined || d === undefined || !plan.weeks[w] || !plan.days[d] || !isTraining(plan.days[d])) {
    outer: for (let wi = 0; wi < plan.weeks.length; wi++) {
      for (let di = 0; di < plan.days.length; di++) {
        if (isTraining(plan.days[di]) && !sessionDone(plan, entries, wi, di)) { w = wi; d = di; break outer; }
      }
    }
    if (w === undefined || d === undefined) {
      blockDone = true;
      w = plan.weeks.length - 1;
      d = plan.days.map(isTraining).lastIndexOf(true);
    }
  }
  const wk = plan.weeks[w], tday = plan.days[d] as TrainingDay;
  return {
    person: ascii(p.name), block: block.number, blockDone,
    week: w, day: d, weekName: ascii(wk.name), rir: wk.rir,
    title: ascii(`${tday.d} ${tday.title}`),
    lifts: tday.lifts.map(l => {
      const e = entries[`${w}-${d}-${slug(l.name)}`];
      const info = library()[l.name];
      return {
        name: ascii(l.name).slice(0, 40),
        sets: setsFor(l, wk),
        reps: ascii(l.reps),
        repT: parseInt(l.reps, 10) || 10,
        rest: restSecs(l.rest),
        load: loadLabel(l.name),
        kg: suggestKg(p.id, block.number, plan, entries, w!, l.name),
        logged: ((e?.sets as Entry[] | undefined) ?? []).filter(s => s.done).map(s => ({ kg: s.kg ?? '', reps: s.reps ?? '', fail: !!s.fail })),
        // For the watch's info and photo pages; photos come from /watch/photo/<photo>-<n>.jpg.
        what: ascii(String(info?.what ?? '')).slice(0, 160),
        steps: ((info?.steps ?? []) as string[]).slice(0, 8).map(s => ascii(s).slice(0, 120)),
        photo: info?.photo && info.images ? String(info.photo) : '',
      };
    }),
    cardio: { ...cardioFor(plan, tday, wk), done: !!entries[`${w}-${d}-cardio`]?.done },
    // Other sessions this week, for "Other day" on the watch.
    week_sessions: plan.days.map((dd, di) => isTraining(dd)
      ? { day: di, title: ascii(`${dd.d} ${dd.title}`), done: sessionDone(plan, entries, w!, di) }
      : null).filter(Boolean),
  };
}

function meta(plan: Plan, w: number, d: number, item: string): Entry {
  const day = plan.days[d] as TrainingDay;
  return { week: plan.weeks[w].name, day: `${day.d} ${day.title}`, item, date: new Date().toISOString().slice(0, 10) };
}

function authWatch(req: Request, res: Response, next: NextFunction) {
  const key = (req.headers['x-watch-key'] as string) || (req.query.key as string) || '';
  const p = key ? db.prepare('SELECT * FROM profiles WHERE watch_key = ?').get(key) as ProfileRow | undefined : undefined;
  if (!p) return res.status(401).json({ error: 'Unknown watch key' });
  res.locals.profile = p;
  next();
}

const int = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number.isInteger(+(v as string)) ? +(v as string) : NaN);

export const watch = Router();
watch.use(authWatch);

// The next unfinished session, or a specific one with ?week=&day=.
watch.get('/session', (req, res) => {
  const w = int(req.query.week), d = int(req.query.day);
  if (Number.isNaN(w) || Number.isNaN(d)) return res.status(400).json({ error: 'week and day must be numbers' });
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

// One finished set: { week, day, lift (index), set (index), kg, reps, fail }.
watch.post('/set', (req, res) => {
  const p = res.locals.profile as ProfileRow;
  const { week, day, lift, set, kg, reps, fail } = req.body ?? {};
  const block = ensureBlock(p);
  const plan = blockPlan(block);
  const tday = plan.days[day];
  if (!plan.weeks[week] || !tday || !isTraining(tday) || !tday.lifts[lift] || !(Number.isInteger(set) && set >= 0 && set < 12)) {
    return res.status(400).json({ error: 'No such exercise or set in your current plan' });
  }
  const l = tday.lifts[lift], key = `${week}-${day}-${slug(l.name)}`;
  const entries = blockEntries(p.id, block.id) as Record<string, Entry>;
  const e: Entry = entries[key] ?? meta(plan, week, day, l.name);
  const target = setsFor(l, plan.weeks[week]);
  e.sets = (e.sets as Entry[] | undefined) ?? [];
  while (e.sets.length < Math.max(target, set + 1)) e.sets.push({ kg: '', reps: '', done: false });
  e.sets[set] = { kg: String(kg ?? ''), reps: String(reps ?? ''), done: true, ...(fail ? { fail: true } : {}) };
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
  const tday = plan.days[day];
  if (!plan.weeks[week] || !tday || !isTraining(tday)) return res.status(400).json({ error: 'No such session in your current plan' });
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
  const tday = plan.days[day];
  if (!plan.weeks[week] || !tday || !isTraining(tday)) return res.status(400).json({ error: 'No such session in your current plan' });
  const key = `${week}-${day}-watch`;
  const e: Entry = (blockEntries(p.id, block.id) as Record<string, Entry>)[key] ?? meta(plan, week, day, 'Garmin activity');
  for (const f of ['min', 'avgHr', 'maxHr', 'kcal'] as const) {
    const v = int(req.body[f]);
    if (v !== undefined && !Number.isNaN(v) && v >= 0 && v < 10000) e[f] = String(v);
  }
  putEntry(p.id, block.id, key, e);
  res.json({ ok: true });
});
