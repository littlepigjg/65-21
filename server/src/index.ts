import express from 'express';
import cors from 'cors';
import { initStorage } from './utils/storage';
import configRouter from './routes/config';
import syncRouter from './routes/sync';
import conflictsRouter from './routes/conflicts';
import recordsRouter from './routes/records';
import eventsRouter from './routes/events';
import { syncEngine } from './modules/SyncEngine';
import { eventLogManager } from './modules/EventLogManager';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/config', configRouter);
app.use('/api/sync', syncRouter);
app.use('/api/conflicts', conflictsRouter);
app.use('/api/records', recordsRouter);
app.use('/api/events', eventsRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

async function startServer() {
  try {
    await initStorage();
    console.log('[Storage] Initialized');

    await eventLogManager.init();
    console.log('[EventLogManager] Initialized');

    app.listen(PORT, () => {
      console.log(`[Server] Running on http://localhost:${PORT}`);
    });

    if (process.env.AUTO_START !== 'false') {
      await syncEngine.start();
    }
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  console.log('[Server] Shutting down...');
  await syncEngine.stop();
  await eventLogManager.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Server] Shutting down...');
  await syncEngine.stop();
  await eventLogManager.shutdown();
  process.exit(0);
});

startServer();
