import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { loginLimiter, getRequestIp, normalizeLoginKey } from '../middleware';
import { JWT_SECRET, LOGIN_LOCK_WINDOW_MS, LOGIN_ATTEMPT_LIMIT } from '../config';
import { loadStateFromNormalized, resolveUserShopAccess, toAuthRecordFromUser, getUserFixedShop, getUserAllowedShops } from '../db';
import { Role } from '../../src/types';

const router = Router();
const loginAttempts = new Map<string, { failedCount: number; lockUntil: number }>();

const createAuthToken = (user: { email: string; name: string; role: Role; scopedShopId?: string; allowedShopIds?: string[]; fixedShopId?: string }) => {
  return jwt.sign(
    {
      email: user.email,
      name: user.name,
      role: user.role,
      scopedShopId: user.scopedShopId,
      allowedShopIds: user.allowedShopIds,
      fixedShopId: user.fixedShopId,
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
};

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password, shopId } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const ipAddress = getRequestIp(req);
  const loginKey = normalizeLoginKey(String(email), ipAddress);
  const entry = loginAttempts.get(loginKey);
  if (entry && entry.lockUntil > Date.now()) {
    const retryAfterSeconds = Math.ceil((entry.lockUntil - Date.now()) / 1000);
    return res.status(429).json({ error: `Account temporarily locked. Try again in ${retryAfterSeconds}s.` });
  }

  if (entry && entry.lockUntil <= Date.now()) {
    loginAttempts.delete(loginKey);
  }

  const dbState = await loadStateFromNormalized();
  if (!dbState) {
    return res.status(503).json({ error: 'Database is starting up or has no user records' });
  }

  const user = dbState.users.find((entry: any) => entry.email.toLowerCase() === String(email).toLowerCase());
  if (!user) {
    const current = loginAttempts.get(loginKey) || { failedCount: 0, lockUntil: 0 };
    current.failedCount += 1;
    if (current.failedCount >= LOGIN_ATTEMPT_LIMIT) {
      current.lockUntil = Date.now() + LOGIN_LOCK_WINDOW_MS;
    }
    loginAttempts.set(loginKey, current);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const validPassword = await bcrypt.compare(String(password), user.passwordHash);
  if (!validPassword) {
    const current = loginAttempts.get(loginKey) || { failedCount: 0, lockUntil: 0 };
    current.failedCount += 1;
    if (current.failedCount >= LOGIN_ATTEMPT_LIMIT) {
      current.lockUntil = Date.now() + LOGIN_LOCK_WINDOW_MS;
    }
    loginAttempts.set(loginKey, current);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  loginAttempts.delete(loginKey);

  const shopProfiles = dbState.settings?.shopProfiles || [];
  const access = resolveUserShopAccess(toAuthRecordFromUser(user), typeof shopId === 'string' ? shopId : '', shopProfiles);
  if ('error' in access) {
    return res.status(access.status).json({ error: access.error });
  }

  const token = createAuthToken({
    email: user.email,
    name: user.name,
    role: user.role,
    scopedShopId: access.scopedShopId,
    allowedShopIds: access.allowedShopIds,
    fixedShopId: access.fixedShopId,
  });

  res.json({
    token,
    user: {
      email: user.email,
      name: user.name,
      role: user.role,
      scopedShopId: access.scopedShopId,
      allowedShopIds: access.allowedShopIds,
      fixedShopId: access.fixedShopId,
    },
  });
});

router.get('/shops', async (req, res) => {
  const queryEmail = String(req.query.email || '').trim().toLowerCase();
  const dbState = await loadStateFromNormalized();
  if (!dbState) {
    return res.json({ shops: [] });
  }

  const user = queryEmail ? dbState.users.find((entry: any) => entry.email.toLowerCase() === queryEmail) : undefined;
  const fixedShopId = user ? getUserFixedShop(user.email) : undefined;
  const roleAllowedShopIds = user ? getUserAllowedShops(user) : undefined;

  const shops = (dbState.settings?.shopProfiles || [])
    .filter((shop: any) => !roleAllowedShopIds || roleAllowedShopIds.includes(String(shop.id)))
    .filter((shop: any) => !fixedShopId || String(shop.id) === fixedShopId)
    .map((shop: any) => ({
      id: String(shop.id),
      name: String(shop.name || shop.id),
      address: String(shop.address || ''),
      phone: String(shop.phone || ''),
    }));

  res.json({ shops });
});

export default router;
