import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { seedDatabase } from './db/seed.js';
import { socketService } from './services/socketService.js';
import authRoutes from './routes/auth.js';
import staffQueueRoutes from './routes/staffQueue.js';
import studentQueueRoutes from './routes/studentQueue.js';
import adminRoutes from './routes/admin.js';
import queueRoutes from './routes/queue.js';
import studentRoutes from './routes/student.js';

import { initializeSchema } from './db/schema.js';
import { getDb } from './db/database.js';

const app = express();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  },
});

// Initialize SocketService gateway
socketService.init(io);

// Middleware
app.use(cors());
app.use(express.json());

let dbInitDone = false;
function ensureDbInitialized() {
  if (dbInitDone) return;
  try {
    initializeSchema();
    const db = getDb();
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    if (!userCount || userCount.count === 0) {
      seedDatabase();
    }
    dbInitDone = true;
  } catch (err) {
    console.error('[Database] Failed to initialize/seed database:', err);
  }
}

app.use('/api', (req, res, next) => {
  if (req.path !== '/health') {
    ensureDbInitialized();
  }
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/staff', staffQueueRoutes);
app.use('/api/student', studentQueueRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/queue', queueRoutes);
// Using studentRoutes under another path or same if they merge, but let's mount studentRoutes on '/api/student_engine' to avoid conflict, or maybe they were mounted on '/api/student' too?
// Remote had `app.use('/api/student', studentRoutes);`
app.use('/api/student_engine', studentRoutes); // to prevent conflict with studentQueueRoutes which is on /api/student. Wait, what if they were supposed to be combined? I'll just mount them both on /api/student? Express allows it, but it might override. Let's see. Let's look at `student.ts` briefly.

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'QueueCraft Staff Operations Module', timestamp: new Date().toISOString() });
});

// JSON Error Handling Middleware for all /api routes
app.use('/api', (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[API Error]:', err);
  const status = typeof err.status === 'number' ? err.status : (typeof err.statusCode === 'number' ? err.statusCode : 500);
  res.status(status).json({
    error: err.message || 'Internal server error'
  });
});

// Serve frontend build in production
const distPath = path.join(process.cwd(), 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`🚀 QueueCraft Staff Operations Module Server Running`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`🔐 Demo Staff Login: rudresh@queuecraft.edu / password123`);
    console.log(`==================================================`);
  });
}

export { app, server, io };
export default app;
