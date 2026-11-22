import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware';
import { loadStateFromNormalized, insertUser, updateUser, deleteUser, resolveUserShopAccess, toAuthRecordFromUser } from '../db';
import { UserAccount, Role } from '../../src/types';
import bcrypt from 'bcryptjs';

const router = Router();

router.use(requireAuth);
router.use(requireRole(['Super Admin']));

router.get('/', async (req, res) => {
  const dbState = await loadStateFromNormalized();
  if (!dbState) {
    return res.json({ users: [] });
  }

  res.json({
    users: dbState.users.map((user: UserAccount) => {
      const access = resolveUserShopAccess(toAuthRecordFromUser(user), '', dbState.settings?.shopProfiles || []);
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        scopedShopId: access.scopedShopId,
        allowedShopIds: access.allowedShopIds,
        fixedShopId: access.fixedShopId,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };
    }),
  });
});

router.post('/', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim();
  const role = String(req.body?.role || '').trim() as Role;
  const password = String(req.body?.password || '');

  if (!email || !name || !role || !password) {
    return res.status(400).json({ error: 'Email, name, role, and password are required' });
  }
  if (!['Super Admin', 'Store Manager', 'Cashier', 'Inventory Staff'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const dbState = await loadStateFromNormalized();
  if (dbState && dbState.users.some((user: any) => user.email.toLowerCase() === email)) {
    return res.status(409).json({ error: 'A user with this email already exists' });
  }

  const getUserRecordId = (mail: string) => `usr-${mail.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const newUser: UserAccount = {
    id: getUserRecordId(email),
    email,
    name,
    role,
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await insertUser(newUser);

  const shopProfiles = dbState?.settings?.shopProfiles || [];
  const access = resolveUserShopAccess(toAuthRecordFromUser(newUser), '', shopProfiles);
  return res.status(201).json({
    user: {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      scopedShopId: access.scopedShopId,
      allowedShopIds: access.allowedShopIds,
      fixedShopId: access.fixedShopId,
      createdAt: newUser.createdAt,
      updatedAt: newUser.updatedAt,
    },
  });
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const dbState = await loadStateFromNormalized();
  const existing = dbState?.users.find((user: any) => user.id === id);
  if (!existing) {
    return res.status(404).json({ error: 'User not found' });
  }

  const nextEmail = String(req.body?.email || existing.email).trim().toLowerCase();
  const nextName = String(req.body?.name || existing.name).trim();
  const nextRole = String(req.body?.role || existing.role).trim() as Role;
  const nextPassword = String(req.body?.password || '');

  if (!nextEmail || !nextName || !nextRole) {
    return res.status(400).json({ error: 'Email, name, and role are required' });
  }
  if (!['Super Admin', 'Store Manager', 'Cashier', 'Inventory Staff'].includes(nextRole)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (nextPassword.length > 0 && nextPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (dbState && dbState.users.some((user: any) => user.email.toLowerCase() === nextEmail && user.id !== id)) {
    return res.status(409).json({ error: 'A user with this email already exists' });
  }

  const updatedUser: UserAccount = {
    ...existing,
    email: nextEmail,
    name: nextName,
    role: nextRole,
    passwordHash: nextPassword ? bcrypt.hashSync(nextPassword, 10) : existing.passwordHash,
    updatedAt: new Date().toISOString(),
  };

  await updateUser(id, updatedUser);

  const shopProfiles = dbState?.settings?.shopProfiles || [];
  const access = resolveUserShopAccess(toAuthRecordFromUser(updatedUser), '', shopProfiles);
  return res.json({
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: updatedUser.role,
      scopedShopId: access.scopedShopId,
      allowedShopIds: access.allowedShopIds,
      fixedShopId: access.fixedShopId,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt,
    },
  });
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const dbState = await loadStateFromNormalized();
  const existing = dbState?.users.find((user: any) => user.id === id);
  if (!existing) {
    return res.status(404).json({ error: 'User not found' });
  }

  const authUser = (req as any).authUser;
  if (authUser && authUser.email.toLowerCase() === existing.email.toLowerCase()) {
    return res.status(400).json({ error: 'You cannot delete your own account while signed in' });
  }

  await deleteUser(id);
  return res.json({ ok: true });
});

export default router;
