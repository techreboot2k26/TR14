import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/database.js';
import { hashPassword } from '../db/seed.js';
import { authenticateToken, JWT_SECRET, AuthRequest } from '../middleware/auth.js';

const router = Router();

// POST /api/auth/login
router.post('/login', (req, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;

  if (!user) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const inputHash = hashPassword(password);
  if (user.password_hash !== inputHash) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const tokenPayload = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

  // Get counter assignment if user is staff
  let counter = null;
  if (user.role === 'STAFF') {
    counter = db.prepare(`
      SELECT c.*, s.name as service_name, s.code as service_code
      FROM counters c
      JOIN services s ON c.service_id = s.id
      WHERE c.assigned_staff_id = ?
    `).get(user.id);
  }

  res.json({
    token: accessToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      created_at: user.created_at,
    },
    counter,
  });
});

// GET /api/auth/me
router.get('/me', authenticateToken, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const db = getDb();
  const user = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(req.user.id) as any;

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  let counter = null;
  if (user.role === 'STAFF') {
    counter = db.prepare(`
      SELECT c.*, s.name as service_name, s.code as service_code
      FROM counters c
      JOIN services s ON c.service_id = s.id
      WHERE c.assigned_staff_id = ?
    `).get(user.id);
  }

  res.json({
    user,
    counter,
  });
});

export default router;
