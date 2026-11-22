import express from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { JWT_SECRET, LOGIN_LOCK_WINDOW_MS } from './config';
import { AuthUser, Role } from '../src/types';

export type AppRequest = express.Request & { authUser?: AuthUser };

export const requireAuth: express.RequestHandler = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    (req as AppRequest).authUser = {
      email: decoded.email,
      name: decoded.name,
      role: decoded.role,
      scopedShopId: decoded.scopedShopId,
      allowedShopIds: Array.isArray(decoded.allowedShopIds) ? decoded.allowedShopIds : undefined,
      fixedShopId: typeof decoded.fixedShopId === 'string' ? decoded.fixedShopId : undefined,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const requireRole = (roles: Role[]): express.RequestHandler => {
  return (req, res, next) => {
    const authUser = (req as AppRequest).authUser;
    if (!authUser || !roles.includes(authUser.role)) {
      return res.status(403).json({ error: 'Forbidden: role does not have access to this action' });
    }
    next();
  };
};

export const loginLimiter = rateLimit({
  windowMs: LOGIN_LOCK_WINDOW_MS,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

export const normalizeLoginKey = (email: string, ip: string) => `${email.trim().toLowerCase()}::${ip}`;

export const getRequestIp = (req: express.Request) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || 'unknown';
};

// Helper for extracting active shop ID context from request headers
export const getActiveShopContext = (req: express.Request) => {
  const requestShopHeader = req.headers['x-shop-id'];
  const activeShopId = typeof requestShopHeader === 'string' && requestShopHeader.trim().length > 0
    ? requestShopHeader.trim()
    : 'shop-main';
  return { activeShopId };
};
