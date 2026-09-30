import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { mutateStore, readStore } from './db.js';

const secret = () => process.env.JWT_SECRET || 'replace-this-secret-before-production';
const ownerUsername = () => process.env.OWNER_USERNAME || 'admin';
const ownerPassword = () => process.env.OWNER_PASSWORD || 'ZeeorAdmin!2026';

export const DEFAULT_RESELLERS = [{ username: 'zeeor-partner', password: 'ZeeorPartner#2026', displayName: 'ZEEOR Partner' }];

export function ensureDefaultResellers() {
  const store = readStore();
  const existing = new Set(store.resellers.map((entry) => entry.username));
  const missing = DEFAULT_RESELLERS.filter((entry) => !existing.has(entry.username));
  if (!missing.length) return;
  mutateStore((next) => {
    for (const entry of missing) next.resellers.push({ id: `r-${entry.username}`, username: entry.username, displayName: entry.displayName, passwordHash: hashPassword(entry.password), listings: [], createdAt: new Date().toISOString() });
    return next;
  });
}

export function signUser(user) { return jwt.sign({ sub: user.id, role: user.role, username: user.username }, secret(), { expiresIn: '7d' }); }
export function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try { req.auth = jwt.verify(token, secret()); } catch { return res.status(401).json({ error: 'Session expired' }); }
  if (req.auth?.role === 'reseller' && !readStore().resellers.some((r) => r.id === req.auth.sub)) return res.status(401).json({ error: 'This seller account no longer exists' });
  next();
}
export function requireRole(...roles) { return (req, res, next) => roles.includes(req.auth?.role) ? next() : res.status(403).json({ error: 'Insufficient permissions' }); }
export function authenticate(username, password) {
  if (username === ownerUsername() && password === ownerPassword()) return { id: 'owner', username, role: 'owner' };
  const reseller = readStore().resellers.find((entry) => entry.username === username && bcrypt.compareSync(password, entry.passwordHash));
  return reseller ? { id: reseller.id, username: reseller.username, role: 'reseller' } : null;
}
export function hashPassword(password) { return bcrypt.hashSync(password, 12); }
