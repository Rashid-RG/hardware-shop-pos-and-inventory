import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { requireAuth, AppRequest } from '../middleware';
import { pool, loadStateFromNormalized, resolveUserShopAccess, toAuthRecordFromUser } from '../db';
import { JWT_SECRET } from '../config';
import { Role } from '../../src/types';

const router = Router();

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

router.use(requireAuth);

router.get('/', async (req, res) => {
  const authUser = (req as AppRequest).authUser;
  if (!authUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dbState = await loadStateFromNormalized();
  const user = dbState?.users.find((entry: any) => entry.email.toLowerCase() === authUser.email.toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'User profile not found' });
  }

  const shopProfiles = dbState.settings?.shopProfiles || [];
  const access = resolveUserShopAccess(toAuthRecordFromUser(user), authUser.scopedShopId || '', shopProfiles);
  if ('error' in access) {
    return res.status(access.status).json({ error: access.error });
  }

  return res.json({
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

router.put('/', async (req, res) => {
  const authUser = (req as AppRequest).authUser;
  if (!authUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dbState = await loadStateFromNormalized();
  const user = dbState?.users.find((entry: any) => entry.email.toLowerCase() === authUser.email.toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'User profile not found' });
  }

  const requestedName = String(req.body?.name || '').trim();
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const wantsPasswordChange = currentPassword.length > 0 || newPassword.length > 0;

  if (requestedName && requestedName.length < 2) {
    return res.status(400).json({ error: 'Name must be at least 2 characters' });
  }

  if (wantsPasswordChange) {
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
  }

  const finalName = requestedName || user.name;
  const finalPasswordHash = wantsPasswordChange ? bcrypt.hashSync(newPassword, 10) : user.passwordHash;

  await pool.query(
    `
    UPDATE users
    SET name = $1, password_hash = $2, updated_at = NOW()
    WHERE email = $3
    `,
    [finalName, finalPasswordHash, user.email]
  );

  const updatedUser = {
    ...user,
    name: finalName,
    passwordHash: finalPasswordHash,
  };

  const shopProfiles = dbState.settings?.shopProfiles || [];
  const access = resolveUserShopAccess(toAuthRecordFromUser(updatedUser), authUser.scopedShopId || '', shopProfiles);
  if ('error' in access) {
    return res.status(access.status).json({ error: access.error });
  }

  const token = createAuthToken({
    email: updatedUser.email,
    name: updatedUser.name,
    role: updatedUser.role,
    scopedShopId: access.scopedShopId,
    allowedShopIds: access.allowedShopIds,
    fixedShopId: access.fixedShopId,
  });

  return res.json({
    token,
    user: {
      email: updatedUser.email,
      name: updatedUser.name,
      role: updatedUser.role,
      scopedShopId: access.scopedShopId,
      allowedShopIds: access.allowedShopIds,
      fixedShopId: access.fixedShopId,
    },
  });
});

export default router;
