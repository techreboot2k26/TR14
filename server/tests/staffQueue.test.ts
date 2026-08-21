import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { getDb, closeDb } from '../db/database.js';
import { seedDatabase } from '../db/seed.js';

describe('Staff Queue Operations Module Integration & State Machine Tests', () => {
  let staffToken: string;
  let studentToken: string;
  let unassignedStaffToken: string;

  beforeEach(() => {
    // Reset database to clean seeded state before each test
    seedDatabase();

    // Generate test JWT tokens
    const db = getDb();
  });

  afterAll(() => {
    closeDb();
  });

  // 1. AUTHENTICATION & RBAC TESTS
  describe('1. Authentication & RBAC Access Control', () => {
    it('should authenticate valid staff user Rudresh', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'rudresh@queuecraft.edu', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.role).toBe('STAFF');
      expect(res.body.counter.name).toBe('Printer Counter 2');
      staffToken = res.body.token;
    });

    it('should reject invalid password login', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'rudresh@queuecraft.edu', password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid/i);
    });

    it('should block student user from accessing staff dashboard APIs', async () => {
      // Login as student
      const studentLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: 'student@queuecraft.edu', password: 'password123' });

      studentToken = studentLogin.body.token;

      const res = await request(app)
        .get('/api/staff/dashboard')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/restricted/i);
    });
  });

  // 2. STAFF DASHBOARD & QUEUE LOADING TESTS
  describe('2. Dashboard & Queue Ordering (Priority Engine)', () => {
    it('should load staff dashboard with assigned service, counter, and waiting queue', async () => {
      const res = await request(app)
        .get('/api/staff/dashboard')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.counter.name).toBe('Printer Counter 2');
      expect(res.body.current_token).toBeDefined();
      expect(res.body.current_token.token_number).toBe('LP-041'); // Initially serving token
      expect(res.body.waiting_queue.length).toBeGreaterThan(0);
    });

    it('should list priority HIGH tokens first in waiting queue', async () => {
      const res = await request(app)
        .get('/api/staff/counter/queue')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      // First token in queue should be LP-044 because it has priority = HIGH
      expect(res.body[0].token_number).toBe('LP-044');
      expect(res.body[0].priority).toBe('HIGH');
    });

    it('should include HELD tokens separately so staff can resume them (Regression: BUG-002)', async () => {
      const res = await request(app)
        .get('/api/staff/dashboard')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      // held_count stat reports 1 (seeded LP-045), and held_tokens must actually
      // contain that token so the staff UI can render a Resume action for it.
      expect(res.body.stats.held_count).toBe(1);
      expect(res.body.held_tokens).toBeDefined();
      expect(res.body.held_tokens.length).toBe(1);
      expect(res.body.held_tokens[0].token_number).toBe('LP-045');
      expect(res.body.held_tokens[0].status).toBe('HELD');

      // waiting_queue must NOT contain HELD tokens (it's WAITING-only by design)
      expect(res.body.waiting_queue.every((t: any) => t.status === 'WAITING')).toBe(true);
    });
  });

  // 3. QUEUE STATE MACHINE & OPERATIONS TESTS
  describe('3. Queue Operations & State Machine Transitions', () => {
    it('should COMPLETE the currently serving token LP-041', async () => {
      const res = await request(app)
        .post('/api/staff/tokens/tkn-041/complete')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.token.status).toBe('COMPLETED');
      expect(res.body.token.completed_at).toBeDefined();
    });

    it('should CALL NEXT priority token LP-044 after completing previous token', async () => {
      // First complete LP-041
      await request(app)
        .post('/api/staff/tokens/tkn-041/complete')
        .set('Authorization', `Bearer ${staffToken}`);

      // Call Next
      const nextRes = await request(app)
        .post('/api/staff/counter/next')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(nextRes.status).toBe(200);
      expect(nextRes.body.token.token_number).toBe('LP-044'); // Priority token called first!
      expect(nextRes.body.token.status).toBe('SERVING');
    });

    it('should HOLD the currently serving token LP-041', async () => {
      const res = await request(app)
        .post('/api/staff/tokens/tkn-041/hold')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.token.status).toBe('HELD');
      expect(res.body.token.held_at).toBeDefined();
    });

    it('should RESUME a held token back to SERVING state', async () => {
      // First hold LP-041
      await request(app)
        .post('/api/staff/tokens/tkn-041/hold')
        .set('Authorization', `Bearer ${staffToken}`);

      // Resume LP-041
      const res = await request(app)
        .post('/api/staff/tokens/tkn-041/resume')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.token.status).toBe('SERVING');
    });

    it('should SKIP a token and preserve it in historical database records', async () => {
      const res = await request(app)
        .post('/api/staff/tokens/tkn-041/skip')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.token.status).toBe('SKIPPED');
      expect(res.body.token.skipped_at).toBeDefined();

      // Verify token still exists in database (never deleted!)
      const db = getDb();
      const tokenInDb = db.prepare('SELECT * FROM tokens WHERE id = ?').get('tkn-041') as any;
      expect(tokenInDb).toBeDefined();
      expect(tokenInDb.status).toBe('SKIPPED');
    });
  });

  // 4. INVALID TRANSITIONS & CONCURRENCY SAFEGUARDS
  describe('4. State Safeguards & Concurrency Protection', () => {
    it('should reject CALL NEXT if a token is already SERVING', async () => {
      // LP-041 is already SERVING
      const res = await request(app)
        .post('/api/staff/counter/next')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already has active serving token/i);
    });

    it('should reject invalid state transition (completing an already completed token)', async () => {
      // Complete LP-041
      await request(app)
        .post('/api/staff/tokens/tkn-041/complete')
        .set('Authorization', `Bearer ${staffToken}`);

      // Try completing it again
      const res = await request(app)
        .post('/api/staff/tokens/tkn-041/complete')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid state transition/i);
    });

    it('should reject CALL NEXT when counter is CLOSED', async () => {
      // Close counter
      await request(app)
        .patch('/api/staff/counter/status')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ status: 'CLOSED' });

      // Complete LP-041 to free slot
      await request(app)
        .post('/api/staff/tokens/tkn-041/complete')
        .set('Authorization', `Bearer ${staffToken}`);

      // Try CALL NEXT on CLOSED counter
      const res = await request(app)
        .post('/api/staff/counter/next')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Counter is currently CLOSED/i);
    });
  });
});
