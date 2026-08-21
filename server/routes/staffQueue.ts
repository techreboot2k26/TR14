import { Router, Response } from 'express';
import { getDb } from '../db/database.js';
import { authenticateToken, requireRole, requireCounterAssignment, AuthRequest } from '../middleware/auth.js';
import { queueEngine } from '../services/queueEngine.js';
import { socketService } from '../services/socketService.js';

const router = Router();

// Apply auth & RBAC middleware to all staff queue routes
router.use(authenticateToken);
router.use(requireRole(['STAFF']));
router.use(requireCounterAssignment);

// Helper function to build consolidated dashboard data
function getDashboardData(counter: any) {
  const db = getDb();

  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(counter.service_id) as any;
  const currentToken = queueEngine.getCurrentServingToken(counter.id);
  const waitingQueue = queueEngine.getWaitingQueue(counter.service_id);

  // Held tokens (getWaitingQueue only returns status='WAITING' tokens, so HELD
  // tokens must be fetched separately for the staff dashboard's resume UI)
  const heldTokens = db.prepare(`
    SELECT * FROM tokens WHERE service_id = ? AND status = 'HELD'
  `).all(counter.service_id);

  // Operational stats calculations
  const heldCount = (db.prepare(`
    SELECT COUNT(*) as cnt FROM tokens WHERE service_id = ? AND status = 'HELD'
  `).get(counter.service_id) as any).cnt;

  const completedTodayCount = (db.prepare(`
    SELECT COUNT(*) as cnt FROM tokens
    WHERE counter_id = ? AND status = 'COMPLETED'
    AND date(completed_at) = date('now')
  `).get(counter.id) as any).cnt;

  // Average service time calculation (in minutes)
  const avgTimeResult = db.prepare(`
    SELECT AVG((julianday(completed_at) - julianday(started_at)) * 24 * 60) as avg_mins
    FROM tokens
    WHERE counter_id = ? AND status = 'COMPLETED' AND started_at IS NOT NULL AND completed_at IS NOT NULL
  `).get(counter.id) as any;

  const avgServiceTime = avgTimeResult?.avg_mins ? Math.round(avgTimeResult.avg_mins * 10) / 10 : 4.5;

  return {
    staff: {
      id: counter.assigned_staff_id,
      name: counter.assigned_staff_name || 'Staff Member',
    },
    counter: {
      id: counter.id,
      name: counter.name,
      status: counter.status,
      service_id: counter.service_id,
      service_name: service?.name,
      service_code: service?.code,
    },
    service,
    current_token: currentToken,
    waiting_queue: waitingQueue,
    held_tokens: heldTokens,
    stats: {
      queue_length: waitingQueue.length,
      currently_serving_number: currentToken?.token_number || null,
      waiting_count: waitingQueue.length,
      held_count: heldCount,
      completed_today_count: completedTodayCount,
      avg_service_time_minutes: avgServiceTime,
    },
  };
}

// GET /api/staff/dashboard
router.get('/dashboard', (req: AuthRequest, res: Response) => {
  try {
    const counter = (req as any).assignedCounter;
    const data = getDashboardData(counter);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch dashboard data' });
  }
});

// GET /api/staff/counter
router.get('/counter', (req: AuthRequest, res: Response) => {
  const counter = (req as any).assignedCounter;
  res.json(counter);
});

// GET /api/staff/counter/queue
router.get('/counter/queue', (req: AuthRequest, res: Response) => {
  const counter = (req as any).assignedCounter;
  const queue = queueEngine.getWaitingQueue(counter.service_id);
  res.json(queue);
});

// GET /api/staff/tokens/:tokenId
router.get('/tokens/:tokenId', (req: AuthRequest, res: Response) => {
  const tokenId = String(req.params.tokenId);
  const db = getDb();

  const token = db.prepare(`
    SELECT t.*, s.name as service_name, s.code as service_code, c.name as counter_name
    FROM tokens t
    JOIN services s ON t.service_id = s.id
    LEFT JOIN counters c ON t.counter_id = c.id
    WHERE t.id = ?
  `).get(tokenId) as any;

  if (!token) {
    res.status(404).json({ error: 'Token not found' });
    return;
  }

  res.json(token);
});

// POST /api/staff/counter/next (CALL NEXT)
router.post('/counter/next', (req: AuthRequest, res: Response) => {
  try {
    const counter = (req as any).assignedCounter;
    const result = queueEngine.callNextToken(counter.service_id, counter.id);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    // Emit real-time events
    socketService.emitTokenCalled(counter.id, result.token);
    socketService.emitQueueUpdated(counter.service_id, {
      action: 'CALL_NEXT',
      tokenId: result.token?.id,
      counterId: counter.id,
    });

    const updatedDashboard = getDashboardData(counter);
    res.json({
      message: `Token ${result.token?.token_number} called successfully`,
      token: result.token,
      dashboard: updatedDashboard,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error processing Call Next action' });
  }
});

// POST /api/staff/tokens/:tokenId/complete (COMPLETE)
router.post('/tokens/:tokenId/complete', (req: AuthRequest, res: Response) => {
  try {
    const tokenId = String(req.params.tokenId);
    const counter = (req as any).assignedCounter;

    const result = queueEngine.completeToken(tokenId, counter.id);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    socketService.emitTokenCompleted(counter.id, result.token);
    socketService.emitQueueUpdated(counter.service_id, {
      action: 'COMPLETE',
      tokenId: result.token?.id,
      counterId: counter.id,
    });

    const updatedDashboard = getDashboardData(counter);
    res.json({
      message: `Token ${result.token?.token_number} completed`,
      token: result.token,
      dashboard: updatedDashboard,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error completing token' });
  }
});

// POST /api/staff/tokens/:tokenId/hold (HOLD)
router.post('/tokens/:tokenId/hold', (req: AuthRequest, res: Response) => {
  try {
    const tokenId = String(req.params.tokenId);
    const counter = (req as any).assignedCounter;

    const result = queueEngine.holdToken(tokenId, counter.id);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    socketService.emitTokenHeld(counter.id, result.token);
    socketService.emitQueueUpdated(counter.service_id, {
      action: 'HOLD',
      tokenId: result.token?.id,
      counterId: counter.id,
    });

    const updatedDashboard = getDashboardData(counter);
    res.json({
      message: `Token ${result.token?.token_number} placed on hold`,
      token: result.token,
      dashboard: updatedDashboard,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error holding token' });
  }
});

// POST /api/staff/tokens/:tokenId/resume (RESUME)
router.post('/tokens/:tokenId/resume', (req: AuthRequest, res: Response) => {
  try {
    const tokenId = String(req.params.tokenId);
    const counter = (req as any).assignedCounter;

    const result = queueEngine.resumeToken(tokenId, counter.id);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    socketService.emitTokenResumed(counter.id, result.token);
    socketService.emitQueueUpdated(counter.service_id, {
      action: 'RESUME',
      tokenId: result.token?.id,
      counterId: counter.id,
    });

    const updatedDashboard = getDashboardData(counter);
    res.json({
      message: `Token ${result.token?.token_number} resumed to SERVING`,
      token: result.token,
      dashboard: updatedDashboard,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error resuming token' });
  }
});

// POST /api/staff/tokens/:tokenId/skip (SKIP)
router.post('/tokens/:tokenId/skip', (req: AuthRequest, res: Response) => {
  try {
    const tokenId = String(req.params.tokenId);
    const counter = (req as any).assignedCounter;

    const result = queueEngine.skipToken(tokenId, counter.id);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    socketService.emitTokenSkipped(counter.id, result.token);
    socketService.emitQueueUpdated(counter.service_id, {
      action: 'SKIP',
      tokenId: result.token?.id,
      counterId: counter.id,
    });

    const updatedDashboard = getDashboardData(counter);
    res.json({
      message: `Token ${result.token?.token_number} skipped`,
      token: result.token,
      dashboard: updatedDashboard,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error skipping token' });
  }
});

// PATCH /api/staff/counter/status (COUNTER STATUS TOGGLE)
router.patch('/counter/status', (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.body;
    const allowedStatuses = ['OPEN', 'CLOSED', 'BUSY', 'MAINTENANCE'];

    if (!status || !allowedStatuses.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` });
      return;
    }

    const counter = (req as any).assignedCounter;
    const db = getDb();

    db.prepare('UPDATE counters SET status = ? WHERE id = ?').run(status, counter.id);

    socketService.emitCounterStatusChanged(counter.id, status);
    socketService.emitQueueUpdated(counter.service_id, { action: 'COUNTER_STATUS', status });

    counter.status = status;
    const updatedDashboard = getDashboardData(counter);

    res.json({
      message: `Counter status updated to ${status}`,
      counter: { id: counter.id, status },
      dashboard: updatedDashboard,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error updating counter status' });
  }
});

export default router;
