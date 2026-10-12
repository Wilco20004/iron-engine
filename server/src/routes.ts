import crypto from 'crypto';
import { Router } from 'express';
import { db, ProfileRow } from './db';
import { checkPin, currentProfile, endSession, hashPin, requireProfile, startSession } from './auth';
import { getExercises, getProgram, listPrograms } from './programs';

export const api = Router();

const KEY_RE = /^\d{1,2}-\d{1,2}-(\d{1,2}|end)$/;
const publicProfile = (p: ProfileRow) => ({ id: p.id, name: p.name, programId: p.program_id, age: p.age, hasPin: !!p.pin_hash });
const validPin = (pin: unknown) => pin === undefined || pin === '' || (typeof pin === 'string' && /^\d{4,8}$/.test(pin));

api.get('/health', (_req, res) => res.json({ ok: true }));

api.get('/programs', (_req, res) => res.json(listPrograms()));

// Profile picker on the sign-in screen: names only.
api.get('/profiles', (_req, res) => {
  const rows = db.prepare('SELECT * FROM profiles ORDER BY created_at').all() as ProfileRow[];
  res.json(rows.map(p => ({ id: p.id, name: p.name, hasPin: !!p.pin_hash })));
});

// The first profile can be created by anyone (first run); after that only a
// signed-in household member can add someone.
api.post('/profiles', (req, res) => {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }).n;
  if (count > 0 && !currentProfile(req)) return res.status(401).json({ error: 'Sign in to add a person' });
  const { name, programId, age, pin } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim() || name.length > 40) return res.status(400).json({ error: 'Enter a name (up to 40 characters)' });
  if (!getProgram(programId)) return res.status(400).json({ error: 'Pick a program' });
  if (age !== undefined && age !== null && age !== '' && !(Number.isInteger(+age) && +age >= 12 && +age <= 100)) return res.status(400).json({ error: 'Age must be a whole number between 12 and 100' });
  if (!validPin(pin)) return res.status(400).json({ error: 'PIN must be 4 to 8 digits' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO profiles (id, name, program_id, age, pin_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name.trim(), programId, age ? +age : null, pin ? hashPin(pin) : null, new Date().toISOString());
  if (count === 0) startSession(req, res, id);
  res.status(201).json(publicProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as ProfileRow));
});

api.post('/login', (req, res) => {
  const { profileId, pin } = req.body ?? {};
  const p = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId) as ProfileRow | undefined;
  if (!p) return res.status(404).json({ error: 'That person no longer exists' });
  if (p.pin_hash && (typeof pin !== 'string' || !checkPin(pin, p.pin_hash))) return res.status(401).json({ error: 'Wrong PIN. Try again.' });
  startSession(req, res, p.id);
  res.json(publicProfile(p));
});

api.post('/logout', (req, res) => { endSession(req, res); res.status(204).end(); });

api.get('/me', requireProfile, (_req, res) => res.json(publicProfile(res.locals.profile)));

api.patch('/me', requireProfile, (req, res) => {
  const p = res.locals.profile as ProfileRow;
  const { age, pin, programId } = req.body ?? {};
  if (age !== undefined) {
    if (age !== null && age !== '' && !(Number.isInteger(+age) && +age >= 12 && +age <= 100)) return res.status(400).json({ error: 'Age must be a whole number between 12 and 100' });
    db.prepare('UPDATE profiles SET age = ? WHERE id = ?').run(age ? +age : null, p.id);
  }
  if (pin !== undefined) {
    if (!validPin(pin)) return res.status(400).json({ error: 'PIN must be 4 to 8 digits' });
    db.prepare('UPDATE profiles SET pin_hash = ? WHERE id = ?').run(pin ? hashPin(pin) : null, p.id);
  }
  if (programId !== undefined) {
    if (!getProgram(programId)) return res.status(400).json({ error: 'Pick a program' });
    db.prepare('UPDATE profiles SET program_id = ? WHERE id = ?').run(programId, p.id);
  }
  res.json(publicProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(p.id) as ProfileRow));
});

api.get('/program', requireProfile, (_req, res) => {
  const program = getProgram((res.locals.profile as ProfileRow).program_id);
  if (!program) return res.status(404).json({ error: 'Your program file is missing on the server' });
  res.json({ program, exercises: getExercises() });
});

api.get('/log', requireProfile, (_req, res) => {
  const rows = db.prepare('SELECT key, data FROM log_entries WHERE profile_id = ?').all((res.locals.profile as ProfileRow).id) as { key: string; data: string }[];
  res.json(Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.data)])));
});

api.put('/log/:key', requireProfile, (req, res) => {
  const { key } = req.params;
  if (!KEY_RE.test(key)) return res.status(400).json({ error: 'Bad log key' });
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Log entry must be an object' });
  db.prepare(`INSERT INTO log_entries (profile_id, key, data, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(profile_id, key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
    .run((res.locals.profile as ProfileRow).id, key, JSON.stringify(req.body), new Date().toISOString());
  res.status(204).end();
});

api.delete('/log/:key', requireProfile, (req, res) => {
  db.prepare('DELETE FROM log_entries WHERE profile_id = ? AND key = ?').run((res.locals.profile as ProfileRow).id, req.params.key);
  res.status(204).end();
});

// Bulk import, e.g. a log exported from the first version of the plan.
api.post('/log/import', requireProfile, (req, res) => {
  const entries = req.body?.entries;
  if (!entries || typeof entries !== 'object') return res.status(400).json({ error: 'Expected { entries: { key: entry } }' });
  const pid = (res.locals.profile as ProfileRow).id;
  const upsert = db.prepare(`INSERT INTO log_entries (profile_id, key, data, updated_at) VALUES (?, ?, ?, ?)
                             ON CONFLICT(profile_id, key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`);
  let n = 0;
  db.transaction(() => {
    for (const [key, value] of Object.entries(entries)) {
      if (!KEY_RE.test(key) || !value || typeof value !== 'object') continue;
      upsert.run(pid, key, JSON.stringify(value), new Date().toISOString());
      n++;
    }
  })();
  res.json({ imported: n });
});
