require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');

const connectDB = require('./config/database');
const authRoutes = require('./routes/auth');
const requestRoutes = require('./routes/requests');
const { notifRouter, userRouter } = require('./routes/notifications');
const internalRouter = require('./routes/internal');
const wf6Router = require('./routes/wf6');
const { adapter } = require('./bot/botAdapter');
const { teamsBot } = require('./bot/teamsBot');
const schedulerService = require('./services/schedulerService');

// ── App Initialization ─────────────────────────────────────────────────────
const app = express();
const httpServer = createServer(app);

// Socket.io enables real-time status updates pushed to connected browsers
// When a request is approved or deployed, the dashboard updates instantly
// without the user needing to refresh.
const io = new Server(httpServer, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }
});

// Make io accessible inside route handlers via req.app.get('io')
app.set('io', io);

// ── MongoDB Connection ─────────────────────────────────────────────────────
connectDB();

// ── Security & Parsing Middleware ──────────────────────────────────────────
app.use(helmet());  // Sets secure HTTP headers (XSS protection, HSTS, etc.)
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));  // HTTP request logging

// Rate limiting: prevents brute-force attacks and API abuse
// 100 requests per 15 minutes per IP is generous for a bot interface
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

// ── API Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/notifications', notifRouter);
app.use('/api/users', userRouter);
app.use('/api/internal', internalRouter);
app.use('/api/wf6', wf6Router);

// Teams Bot endpoint (Azure Bot Service -> this route)
app.post('/api/bot', async (req, res) => {
  await adapter.processActivity(req, res, async (context) => {
    await teamsBot.run(context);
  });
});

// ── Health Check ───────────────────────────────────────────────────────────
// Used by Azure App Service, Kubernetes liveness probes, and monitoring tools
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV
  });
});

// ── Global Error Handler ───────────────────────────────────────────────────
// Catches any unhandled errors from route handlers so they don't crash the server
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// ── 404 Handler ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

// ── Socket.io Connection Handling ─────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Each authenticated user joins a room named after their user ID.
  // This lets us push notifications specifically to the right person.
  socket.on('join', (userId) => {
    socket.join(`user_${userId}`);
    console.log(`User ${userId} joined their notification room`);
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// ── Start Server ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`\n🚀 Claude Assistant Bot Server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV}`);
  console.log(`   Health check: http://localhost:${PORT}/health\n`);
  schedulerService.start();
});

module.exports = { app, io };
