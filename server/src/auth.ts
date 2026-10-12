import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { db, ProfileRow } from './db';

const COOKIE = 'ie_session';
const MAX_AGE_DAYS = 180;

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function checkPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(pin, salt, 32);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function startSession(req: Request, res: Response, profileId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, profile_id, created_at) VALUES (?, ?, ?)').run(token, profileId, new Date().toISOString());
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: MAX_AGE_DAYS * 864e5, path: '/' });
}

export function endSession(req: Request, res: Response) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(COOKIE, { path: '/' });
}

export function currentProfile(req: Request): ProfileRow | undefined {
  const token = readCookie(req, COOKIE);
  if (!token) return undefined;
  return db.prepare(
    `SELECT p.* FROM sessions s JOIN profiles p ON p.id = s.profile_id
     WHERE s.token = ? AND s.created_at > ?`,
  ).get(token, new Date(Date.now() - MAX_AGE_DAYS * 864e5).toISOString()) as ProfileRow | undefined;
}

export function requireProfile(req: Request, res: Response, next: NextFunction) {
  const profile = currentProfile(req);
  if (!profile) return res.status(401).json({ error: 'Not signed in' });
  res.locals.profile = profile;
  next();
}
