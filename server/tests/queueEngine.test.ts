import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getDb, closeDb } from '../db/database.js';
import { seedDatabase } from '../db/seed.js';
import { queueEngine, DefaultQueueEngine } from '../services/queueEngine.js';

describe('Smart Queue Engine Service Tests', () => {
  beforeEach(() => {
    // Reset database to clean seeded state before each test
    seedDatabase();
  });

  afterAll(() => {
    closeDb();
  });

  // 0. SKIP OPERATION COUNTER OWNERSHIP (Regression: BUG-001)
  describe('0. Skip Operation Counter Ownership', () => {
    it('should reject skipping a SERVING token from a different counter', () => {
      // tkn-041 is SERVING on cntr-lp-2; attempt to skip it "from" a different counter
      const result = queueEngine.skipToken('tkn-041', 'cntr-cnt-1');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Unauthorized/i);
    });

    it('should reject skipping a HELD token from a different counter', () => {
      // tkn-045 is HELD, originally served on cntr-lp-2
      const result = queueEngine.skipToken('tkn-045', 'cntr-cnt-1');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Unauthorized/i);
    });

    it('should allow skipping a SERVING token from the correct counter', () => {
      const result = queueEngine.skipToken('tkn-041', 'cntr-lp-2');
      expect(result.success).toBe(true);
      expect(result.token?.status).toBe('SKIPPED');
    });

    it('should allow skipping a WAITING token regardless of counter (no binding yet)', () => {
      const result = queueEngine.skipToken('tkn-042', 'cntr-cnt-1');
      expect(result.success).toBe(true);
      expect(result.token?.status).toBe('SKIPPED');
    });
  });

  // 1. NORMAL FIFO QUEUE ORDERING
  describe('1. Normal FIFO Queue Ordering', () => {
    it('should order tokens of the same priority by created_at time (FIFO)', () => {
      const db = getDb();
      
      // Clear all tokens to check fresh FIFO
      db.prepare('DELETE FROM tokens').run();

      const now = new Date();
      const createTime = (offsetMins: number) => new Date(now.getTime() - offsetMins * 60 * 1000).toISOString();

      // Insert tokens out of order in terms of ID, but ordered by created_at
      db.prepare(`
        INSERT INTO tokens (id, token_number, student_name, service_id, priority, status, created_at)
        VALUES ('tkn-c', 'LP-003', 'Student C', 'srv-lp', 'NORMAL', 'WAITING', ?)
      `).run(createTime(5)); // Created 5 mins ago (Oldest)

      db.prepare(`
        INSERT INTO tokens (id, token_number, student_name, service_id, priority, status, created_at)
        VALUES ('tkn-a', 'LP-001', 'Student A', 'srv-lp', 'NORMAL', 'WAITING', ?)
      `).run(createTime(3)); // Created 3 mins ago

      db.prepare(`
        INSERT INTO tokens (id, token_number, student_name, service_id, priority, status, created_at)
        VALUES ('tkn-b', 'LP-002', 'Student B', 'srv-lp', 'NORMAL', 'WAITING', ?)
      `).run(createTime(1)); // Created 1 min ago (Newest)

      const queue = queueEngine.getWaitingQueue('srv-lp');
      expect(queue.length).toBe(3);
      expect(queue[0].id).toBe('tkn-c'); // Oldest should be first
      expect(queue[1].id).toBe('tkn-a');
      expect(queue[2].id).toBe('tkn-b'); // Newest should be last
    });
  });

  // 2. PRIORITY QUEUE ORDERING
  describe('2. Priority Queue Ordering', () => {
    it('should order priority levels correctly (URGENT > HIGH/PRIORITY > NORMAL)', () => {
      const db = getDb();
      db.prepare('DELETE FROM tokens').run();

      const now = new Date().toISOString();

      // Normal token created first
      db.prepare(`
        INSERT INTO tokens (id, token_number, student_name, service_id, priority, status, created_at)
        VALUES ('tkn-normal', 'LP-001', 'Normal Student', 'srv-lp', 'NORMAL', 'WAITING', ?)
      `).run(now);

      // Urgent token created second
      db.prepare(`
        INSERT INTO tokens (id, token_number, student_name, service_id, priority, status, created_at)
        VALUES ('tkn-urgent', 'LP-002', 'Urgent Student', 'srv-lp', 'URGENT', 'WAITING', ?)
      `).run(now);

      // High priority token created third
      db.prepare(`
        INSERT INTO tokens (id, token_number, student_name, service_id, priority, status, created_at)
        VALUES ('tkn-high', 'LP-003', 'High Student', 'srv-lp', 'HIGH', 'WAITING', ?)
      `).run(now);

      // Priority token created fourth
      db.prepare(`
        INSERT INTO tokens (id, token_number, student_name, service_id, priority, status, created_at)
        VALUES ('tkn-priority', 'LP-004', 'Priority Student', 'srv-lp', 'PRIORITY', 'WAITING', ?)
      `).run(now);

      const queue = queueEngine.getWaitingQueue('srv-lp');
      expect(queue.length).toBe(4);
      
      // Expected ordering: URGENT -> HIGH/PRIORITY -> NORMAL
      // Since HIGH and PRIORITY are mapped to value 2, they will sub-sort by FIFO/ID.
      expect(queue[0].id).toBe('tkn-urgent');
      expect(queue[1].priority).toMatch(/HIGH|PRIORITY/);
      expect(queue[2].priority).toMatch(/HIGH|PRIORITY/);
      expect(queue[3].id).toBe('tkn-normal');
    });
  });

  // 3. STARVATION PREVENTION
  describe('3. Starvation Prevention', () => {
    it('should boost a NORMAL token priority if it waits past the threshold', () => {
      const db = getDb();
      db.prepare('DELETE FROM tokens').run();

      // Set starvation threshold to 10 minutes for testing
      process.env.PRIORITY_WAIT_THRESHOLD_MINUTES = '10';

      const now = new Date();
      const minsAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000).toISOString();

      // Normal token waiting 12 minutes (exceeds 10m threshold -> effective priority becomes PRIORITY)
      db.prepare(`
        INSERT INTO tokens (id, token_number, student_name, service_id, priority, status, created_at)
        VALUES ('tkn-starving', 'LP-001', 'Starving Student', 'srv-lp', 'NORMAL', 'WAITING', ?)
      `).run(minsAgo(12));

      // Priority token waiting 1 minute (effective priority remains PRIORITY/HIGH = 2)
      db.prepare(`
        INSERT INTO tokens (id, token_number, student_name, service_id, priority, status, created_at)
        VALUES ('tkn-priority-fresh', 'LP-002', 'Fresh Priority Student', 'srv-lp', 'PRIORITY', 'WAITING', ?)
      `).run(minsAgo(1));

      // Normal token waiting 1 minute (effective priority remains NORMAL = 1)
      db.prepare(`
        INSERT INTO tokens (id, token_number, student_name, service_id, priority, status, created_at)
        VALUES ('tkn-normal-fresh', 'LP-003', 'Fresh Normal Student', 'srv-lp', 'NORMAL', 'WAITING', ?)
      `).run(minsAgo(1));

      const queue = queueEngine.getWaitingQueue('srv-lp');
      
      // Starving token should be ahead of Fresh Priority token due to FIFO tie-break at same effective priority,
      // and ahead of Fresh Normal token due to higher effective priority.
      expect(queue[0].id).toBe('tkn-starving');
      expect(queue[1].id).toBe('tkn-priority-fresh');
      expect(queue[2].id).toBe('tkn-normal-fresh');

      // Cleanup env
      delete process.env.PRIORITY_WAIT_THRESHOLD_MINUTES;
    });
  });

  // 4. QUEUE POSITION & PEOPLE AHEAD CALCULATIONS
  describe('4. Position and People-Ahead Calculation', () => {
    it('should calculate correct position and people ahead count dynamically', () => {
      // In seed database:
      // tkn-041 is SERVING (position 0)
      // tkn-044 is HIGH priority WAITING (position 1, peopleAhead 0)
      // tkn-042 is NORMAL priority WAITING (position 2, peopleAhead 1)
      // tkn-043 is NORMAL priority WAITING (position 3, peopleAhead 2)

      const detailsServing = queueEngine.getTokenPositionDetails('tkn-041');
      expect(detailsServing?.position).toBe(0);
      expect(detailsServing?.peopleAhead).toBe(0);

      const detailsHigh = queueEngine.getTokenPositionDetails('tkn-044');
      expect(detailsHigh?.position).toBe(1);
      expect(detailsHigh?.peopleAhead).toBe(0);

      const detailsNormal1 = queueEngine.getTokenPositionDetails('tkn-042');
      expect(detailsNormal1?.position).toBe(2);
      expect(detailsNormal1?.peopleAhead).toBe(1);

      const detailsNormal2 = queueEngine.getTokenPositionDetails('tkn-043');
      expect(detailsNormal2?.position).toBe(3);
      expect(detailsNormal2?.peopleAhead).toBe(2);
    });
  });

  // 5. ESTIMATED WAITING TIME
  describe('5. Estimated Waiting Time', () => {
    it('should compute reasonable wait estimates considering active serving token', () => {
      const db = getDb();
      
      // Seed two completed tokens to set average service time history
      db.prepare('DELETE FROM tokens').run();

      const now = new Date();
      const minsAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000).toISOString();

      // Complete token 1: served for 4 minutes
      db.prepare(`
        INSERT INTO tokens (id, token_number, student_name, service_id, counter_id, priority, status, created_at, started_at, completed_at)
        VALUES ('tkn-c1', 'LP-001', 'Student A', 'srv-lp', 'cntr-lp-2', 'NORMAL', 'COMPLETED', ?, ?, ?)
      `).run(minsAgo(20), minsAgo(18), minsAgo(14));

      // Complete token 2: served for 6 minutes
      db.prepare(`
        INSERT INTO tokens (id, token_number, student_name, service_id, counter_id, priority, status, created_at, started_at, completed_at)
        VALUES ('tkn-c2', 'LP-002', 'Student B', 'srv-lp', 'cntr-lp-2', 'NORMAL', 'COMPLETED', ?, ?, ?)
      `).run(minsAgo(12), minsAgo(10), minsAgo(4));

      // Average service time is now: (4 + 6) / 2 = 5 minutes.

      // Insert active serving token: started 3 minutes ago (remaining serving time = 5 - 3 = 2 minutes)
      db.prepare(`
        INSERT INTO tokens (id, token_number, student_name, service_id, counter_id, priority, status, created_at, started_at)
        VALUES ('tkn-serving', 'LP-003', 'Student C', 'srv-lp', 'cntr-lp-2', 'NORMAL', 'SERVING', ?, ?)
      `).run(minsAgo(5), minsAgo(3));

      // Insert waiting token: 1 person ahead (tkn-waiting1)
      db.prepare(`
        INSERT INTO tokens (id, token_number, student_name, service_id, priority, status, created_at)
        VALUES ('tkn-waiting1', 'LP-004', 'Student D', 'srv-lp', 'NORMAL', 'WAITING', ?)
      `).run(minsAgo(1));

      // Calculate details for tkn-waiting1
      // peopleAhead = 0 (since it is the first in waiting list).
      // wait = (0 * 5) + remaining = 0 + 2 = 2 minutes.
      const details = queueEngine.getTokenPositionDetails('tkn-waiting1');
      expect(details?.peopleAhead).toBe(0);
      expect(details?.estimatedWaitMinutes).toBe(2);
    });
  });

  // 6. CANCELLATION & RECALCULATION
  describe('6. Cancellation and Dynamic Recalculation', () => {
    it('should update other waiting token positions when a token is cancelled', () => {
      // In seed database, queue is:
      // 1. tkn-044 (HIGH)
      // 2. tkn-042 (NORMAL)
      // 3. tkn-043 (NORMAL)

      // Cancel high priority token tkn-044
      const cancelRes = queueEngine.cancelToken('tkn-044');
      expect(cancelRes.success).toBe(true);
      expect(cancelRes.token?.status).toBe('CANCELLED');

      // Verify positions recalculate
      const detailsNormal1 = queueEngine.getTokenPositionDetails('tkn-042');
      expect(detailsNormal1?.position).toBe(1); // Shifted from 2 to 1
      expect(detailsNormal1?.peopleAhead).toBe(0); // Shifted from 1 to 0

      const detailsNormal2 = queueEngine.getTokenPositionDetails('tkn-043');
      expect(detailsNormal2?.position).toBe(2); // Shifted from 3 to 2
      expect(detailsNormal2?.peopleAhead).toBe(1); // Shifted from 2 to 1
    });
  });

  // 7. WAITLIST AUTO-PROMOTION
  describe('7. Waitlist Auto-Promotion', () => {
    it('should promote the next eligible waiting token when promoteNextToken is triggered', () => {
      // Complete current serving token tkn-041 to free counter
      const completeRes = queueEngine.completeToken('tkn-041', 'cntr-lp-2');
      expect(completeRes.success).toBe(true);

      // Trigger promotion on counter
      const promoteRes = queueEngine.promoteNextToken('srv-lp', 'cntr-lp-2');
      expect(promoteRes.success).toBe(true);
      
      // Highest priority WAITING was tkn-044 (HIGH)
      expect(promoteRes.token?.id).toBe('tkn-044');
      expect(promoteRes.token?.status).toBe('SERVING');
      expect(promoteRes.token?.counter_id).toBe('cntr-lp-2');
      expect(promoteRes.token?.started_at).toBeDefined();
    });
  });

  // 8. INVALID TRANSITIONS
  describe('8. Transition Safeguards', () => {
    it('should reject invalid state transitions', () => {
      // Try calling next on completed token
      const res1 = queueEngine.callNextToken('srv-lp', 'cntr-lp-2');
      // Should fail because tkn-041 is currently SERVING at cntr-lp-2
      expect(res1.success).toBe(false);
      expect(res1.error).toMatch(/already has active serving token/i);

      // Complete tkn-041
      queueEngine.completeToken('tkn-041', 'cntr-lp-2');

      // Try completing it again
      const res2 = queueEngine.completeToken('tkn-041', 'cntr-lp-2');
      expect(res2.success).toBe(false);
      expect(res2.error).toMatch(/Invalid state transition/i);
    });
  });

  // 9. EMPTY QUEUE HANDLING
  describe('9. Empty Queue Handling', () => {
    it('should return clean results for empty queue', () => {
      const db = getDb();
      db.prepare('DELETE FROM tokens').run();

      const nextToken = queueEngine.getNextEligibleToken('srv-lp');
      expect(nextToken).toBeNull();

      const list = queueEngine.getWaitingQueue('srv-lp');
      expect(list.length).toBe(0);

      const res = queueEngine.callNextToken('srv-lp', 'cntr-lp-2');
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/empty/i);
    });
  });
});
