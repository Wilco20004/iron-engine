import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { BlockRow, db, ProfileRow } from './db';
import { Plan, PlanSchema, formatIssues, parseKey, slug, upgradeKey } from './plan';

const PROGRAMS_DIR = process.env.IRON_PROGRAMS_DIR || path.join(__dirname, '..', 'programs');
const now = () => new Date().toISOString();

/* ---------- program templates ---------- */

export function seedPrograms() {
  const get = db.prepare('SELECT customized, file_hash FROM programs WHERE id = ?');
  const insert = db.prepare(`INSERT INTO programs (id, data, source, file_hash, customized, updated_at) VALUES (?, ?, 'file', ?, 0, ?)`);
  const update = db.prepare('UPDATE programs SET data = ?, file_hash = ?, updated_at = ? WHERE id = ?');
  for (const file of fs.readdirSync(PROGRAMS_DIR)) {
    if (!file.endsWith('.json') || file === 'exercises.json') continue;
    const raw = fs.readFileSync(path.join(PROGRAMS_DIR, file), 'utf8');
    const parsed = PlanSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.error(`Skipping ${file}: invalid plan\n${formatIssues(parsed.error)}`);
      continue;
    }
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const row = get.get(parsed.data.id) as { customized: number; file_hash: string } | undefined;
    if (!row) insert.run(parsed.data.id, JSON.stringify(parsed.data), hash, now());
    else if (!row.customized && row.file_hash !== hash) update.run(JSON.stringify(parsed.data), hash, now(), parsed.data.id);
  }
}

export function getTemplate(id: string): Plan | undefined {
  const row = db.prepare('SELECT data FROM programs WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : undefined;
}

export function listTemplates() {
  const rows = db.prepare('SELECT id, data, source, customized, updated_at FROM programs ORDER BY id').all() as { id: string; data: string; source: string; customized: number; updated_at: string }[];
  return rows.map(r => {
    const p = JSON.parse(r.data) as Plan;
    return { id: r.id, name: p.name, subtitle: p.subtitle ?? '', source: r.source, customized: !!r.customized, updatedAt: r.updated_at };
  });
}

export function saveTemplate(plan: Plan) {
  const exists = db.prepare('SELECT 1 FROM programs WHERE id = ?').get(plan.id);
  if (exists) db.prepare('UPDATE programs SET data = ?, customized = 1, updated_at = ? WHERE id = ?').run(JSON.stringify(plan), now(), plan.id);
  else db.prepare(`INSERT INTO programs (id, data, source, customized, updated_at) VALUES (?, ?, 'connector', 1, ?)`).run(plan.id, JSON.stringify(plan), now());
}

/* ---------- exercise library ---------- */

let fileLibrary: Record<string, Record<string, unknown>> | null = null;

export function library(): Record<string, Record<string, unknown>> {
  if (!fileLibrary) fileLibrary = JSON.parse(fs.readFileSync(path.join(PROGRAMS_DIR, 'exercises.json'), 'utf8'));
  const merged = { ...fileLibrary };
  for (const r of db.prepare('SELECT name, data FROM exercises').all() as { name: string; data: string }[]) {
    merged[r.name] = { ...(merged[r.name] ?? {}), ...JSON.parse(r.data) };
  }
  return merged;
}

export function upsertExercise(name: string, data: Record<string, unknown>) {
  db.prepare(`INSERT INTO exercises (name, data, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
    .run(name, JSON.stringify(data), now());
}

/* ---------- people ---------- */

export function findProfile(who: string): ProfileRow | undefined {
  return (db.prepare('SELECT * FROM profiles WHERE id = ?').get(who)
    ?? db.prepare('SELECT * FROM profiles WHERE lower(name) = lower(?)').get(who.trim())) as ProfileRow | undefined;
}

export function listProfiles(): ProfileRow[] {
  return db.prepare('SELECT * FROM profiles ORDER BY created_at').all() as ProfileRow[];
}

/* ---------- blocks ---------- */

export function currentBlock(profileId: string): BlockRow | undefined {
  return db.prepare('SELECT * FROM blocks WHERE profile_id = ? ORDER BY number DESC LIMIT 1').get(profileId) as BlockRow | undefined;
}

export function listBlocks(profileId: string): BlockRow[] {
  return db.prepare('SELECT * FROM blocks WHERE profile_id = ? ORDER BY number').all(profileId) as BlockRow[];
}

export function getBlock(profileId: string, number: number): BlockRow | undefined {
  return db.prepare('SELECT * FROM blocks WHERE profile_id = ? AND number = ?').get(profileId, number) as BlockRow | undefined;
}

export function ensureBlock(profile: ProfileRow): BlockRow {
  const b = currentBlock(profile.id);
  if (b) return b;
  const plan = getTemplate(profile.program_id);
  if (!plan) throw new Error(`Program "${profile.program_id}" is missing`);
  db.prepare('INSERT INTO blocks (profile_id, number, program_id, plan, started_at) VALUES (?, 1, ?, ?, ?)')
    .run(profile.id, plan.id, JSON.stringify(plan), profile.created_at);
  return currentBlock(profile.id)!;
}

export function startBlock(profile: ProfileRow, programId?: string): BlockRow {
  const id = programId ?? profile.program_id;
  const plan = getTemplate(id);
  if (!plan) throw new Error(`There is no program "${id}"`);
  const prev = currentBlock(profile.id);
  db.transaction(() => {
    if (prev) db.prepare('UPDATE blocks SET ended_at = ? WHERE id = ?').run(now(), prev.id);
    db.prepare('INSERT INTO blocks (profile_id, number, program_id, plan, started_at) VALUES (?, ?, ?, ?, ?)')
      .run(profile.id, (prev?.number ?? 0) + 1, plan.id, JSON.stringify(plan), now());
    db.prepare('UPDATE profiles SET program_id = ? WHERE id = ?').run(plan.id, profile.id);
  })();
  return currentBlock(profile.id)!;
}

export function setBlockPlan(blockId: number, plan: Plan) {
  db.prepare('UPDATE blocks SET plan = ? WHERE id = ?').run(JSON.stringify(plan), blockId);
}

export const blockPlan = (b: BlockRow) => JSON.parse(b.plan) as Plan;

/* ---------- log ---------- */

export function blockEntries(profileId: string, blockId: number): Record<string, Record<string, unknown>> {
  const rows = db.prepare('SELECT key, data FROM log_entries WHERE profile_id = ? AND block_id = ?').all(profileId, blockId) as { key: string; data: string }[];
  return Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.data)]));
}

const upsertEntry = db.prepare(`INSERT INTO log_entries (profile_id, block_id, key, data, updated_at) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(profile_id, block_id, key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`);

export function putEntry(profileId: string, blockId: number, key: string, data: unknown) {
  upsertEntry.run(profileId, blockId, key, JSON.stringify(data), now());
}

export function deleteEntry(profileId: string, blockId: number, key: string) {
  db.prepare('DELETE FROM log_entries WHERE profile_id = ? AND block_id = ? AND key = ?').run(profileId, blockId, key);
}

// Import keeps slug keys as they are and converts position keys ("0-0-3").
export function importEntries(profileId: string, block: BlockRow, entries: Record<string, unknown>): number {
  const plan = blockPlan(block);
  let n = 0;
  db.transaction(() => {
    for (const [key, value] of Object.entries(entries)) {
      const k = upgradeKey(plan, key);
      if (!k || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      putEntry(profileId, block.id, k, value);
      n++;
    }
  })();
  return n;
}

// Version 1 stored entries without blocks and keyed by exercise position.
// Move them into each person's block 1 with slug keys.
export function migrateLegacyLog() {
  const old = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'log_entries_v1'`).get();
  if (!old) return;
  db.transaction(() => {
    for (const p of listProfiles()) {
      const block = ensureBlock(p);
      const rows = db.prepare('SELECT key, data FROM log_entries_v1 WHERE profile_id = ?').all(p.id) as { key: string; data: string }[];
      importEntries(p.id, block, Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.data)])));
    }
    db.exec('DROP TABLE log_entries_v1');
  })();
  console.log('Moved version 1 log entries into blocks.');
}

/* ---------- readable summaries (connector) ---------- */

export type Readable = {
  week: string; day: string; item: string; date?: string;
  sets?: { kg: string; reps: string; fail?: boolean }[]; done?: boolean;
  cardio?: Record<string, unknown>; endedEarly?: Record<string, unknown>; garmin?: Record<string, unknown>;
};

export function readableLog(plan: Plan, entries: Record<string, Record<string, unknown>>): Readable[] {
  const out: (Readable & { order: number[] })[] = [];
  for (const [key, e] of Object.entries(entries)) {
    const k = parseKey(key);
    if (!k) continue;
    const day = plan.days[k.day];
    const week = plan.weeks[k.week];
    const liftIndex = day && 'lifts' in day ? day.lifts.findIndex(l => slug(l.name) === k.item) : -1;
    const r: Readable & { order: number[] } = {
      week: week?.name ?? `Week ${k.week + 1}`,
      day: day ? `${day.d} ${day.title}` : `Day ${k.day + 1}`,
      item: k.item === 'cardio' ? 'Cardio' : k.item === 'end' ? 'Ended early' : k.item === 'watch' ? 'Garmin activity'
        : (liftIndex >= 0 && 'lifts' in day ? day.lifts[liftIndex].name : String(e.item ?? k.item)),
      order: [k.week, k.day, k.item === 'watch' ? 100 : k.item === 'end' ? 99 : k.item === 'cardio' ? 98 : liftIndex < 0 ? 97 : liftIndex],
    };
    if (e.date) r.date = String(e.date);
    if (k.item === 'watch') {
      const { min, avgHr, maxHr, kcal } = e as Record<string, unknown>;
      r.garmin = Object.fromEntries(Object.entries({ min, avgHr, maxHr, kcal }).filter(([, v]) => v !== undefined && v !== ''));
    } else if (k.item === 'cardio') {
      const { min, km, hr, rpe, notes, done } = e as Record<string, unknown>;
      r.cardio = Object.fromEntries(Object.entries({ min, km, avgHr: hr, effort: rpe, notes, done }).filter(([, v]) => v !== undefined && v !== ''));
    } else if (k.item === 'end') {
      const { reason, note, exercisesDone, setsDone, cardioDone } = e as Record<string, unknown>;
      r.endedEarly = { reason, note, exercisesDone, setsDone, cardioDone };
    } else {
      const sets = (e.sets as { kg?: string; reps?: string; done?: boolean; fail?: boolean }[] | undefined) ?? [];
      r.sets = sets.filter(s => s.done).map(s => ({ kg: s.kg ?? '', reps: s.reps ?? '', ...(s.fail ? { fail: true } : {}) }));
      r.done = !!e.done;
    }
    out.push(r);
  }
  out.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2] - b.order[2]);
  return out.map(({ order, ...r }) => r);
}

// Best set and estimated 1-rep max (Epley) per exercise, per week, across blocks.
export function progress(profileId: string, exercise?: string) {
  const want = exercise ? slug(exercise) : null;
  const result: Record<string, { block: number; week: string; date?: string; best: string; est1rm?: number; volumeKg: number; failSets: number }[]> = {};
  for (const b of listBlocks(profileId)) {
    const plan = blockPlan(b);
    for (const [key, e] of Object.entries(blockEntries(profileId, b.id))) {
      const k = parseKey(key);
      if (!k || k.item === 'cardio' || k.item === 'end' || k.item === 'watch' || (want && k.item !== want)) continue;
      const sets = ((e.sets as { kg?: string; reps?: string; done?: boolean; fail?: boolean }[]) ?? []).filter(s => s.done);
      if (!sets.length) continue;
      const day = plan.days[k.day];
      const name = day && 'lifts' in day ? day.lifts.find(l => slug(l.name) === k.item)?.name ?? String(e.item ?? k.item) : String(e.item ?? k.item);
      let best = sets[0], bestE = -1, volume = 0;
      for (const s of sets) {
        const kg = parseFloat(s.kg ?? ''), reps = parseInt(s.reps ?? '', 10);
        if (kg > 0 && reps > 0) {
          volume += kg * reps;
          const est = kg * (1 + reps / 30);
          if (est > bestE) { bestE = est; best = s; }
        }
      }
      (result[name] ??= []).push({
        block: b.number,
        week: plan.weeks[k.week]?.name ?? `Week ${k.week + 1}`,
        ...(e.date ? { date: String(e.date) } : {}),
        best: `${best.kg || '?'} kg × ${best.reps || '?'}${best.fail ? ' (to failure)' : ''}`,
        ...(bestE > 0 ? { est1rm: Math.round(bestE * 10) / 10 } : {}),
        volumeKg: Math.round(volume),
        failSets: sets.filter(s => s.fail).length,
      });
    }
  }
  for (const rows of Object.values(result)) rows.sort((a, b) => a.block - b.block || a.week.localeCompare(b.week, undefined, { numeric: true }));
  return result;
}

/* ---------- connector token ---------- */

export function connectorToken(): string {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'mcp_token'`).get() as { value: string } | undefined;
  if (row) return row.value;
  return regenerateConnectorToken();
}

export function regenerateConnectorToken(): string {
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare(`INSERT INTO settings (key, value) VALUES ('mcp_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(token);
  return token;
}

export function validatePlan(input: unknown): { ok: true; plan: Plan } | { ok: false; error: string } {
  const r = PlanSchema.safeParse(input);
  return r.success ? { ok: true, plan: r.data } : { ok: false, error: formatIssues(r.error) };
}
