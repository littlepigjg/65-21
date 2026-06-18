import express from 'express';
import { eventLogManager } from '../modules/EventLogManager';
import { AuditEventType, AuditEventStatus, EventQueryParams } from '../types';

const router = express.Router();

function parseNumber(q: any, defaultValue?: number): number | undefined {
  if (q === undefined || q === null || q === '') return defaultValue;
  const n = parseInt(String(q), 10);
  return isNaN(n) ? defaultValue : n;
}

function parseArray<T>(q: any): T[] | undefined {
  if (q === undefined || q === null || q === '') return undefined;
  if (Array.isArray(q)) return q as T[];
  if (typeof q === 'string') return q.split(',').map((s) => s.trim()) as T[];
  return undefined;
}

router.get('/', async (req, res) => {
  try {
    const params: EventQueryParams = {
      startTime: parseNumber(req.query.startTime),
      endTime: parseNumber(req.query.endTime),
      filePath: req.query.filePath ? String(req.query.filePath) : undefined,
      eventTypes: parseArray<AuditEventType>(req.query.eventTypes),
      status: req.query.status ? (req.query.status as AuditEventStatus) : undefined,
      sourceSide: req.query.sourceSide
        ? (req.query.sourceSide as 'source' | 'target' | 'both')
        : undefined,
      limit: parseNumber(req.query.limit, 1000),
      offset: parseNumber(req.query.offset, 0),
      aggregate:
        req.query.aggregate === 'hourly' ||
        req.query.aggregate === 'daily' ||
        req.query.aggregate === 'count' ||
        req.query.aggregate === 'none'
          ? (req.query.aggregate as any)
          : 'none',
      sample: parseNumber(req.query.sample),
    };

    const result = await eventLogManager.query(params);
    res.json(result);
  } catch (error: any) {
    console.error('[Events Route] Query error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/time-range', async (req, res) => {
  try {
    const range = await eventLogManager.getTimeRange();
    res.json(range);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const stats = await eventLogManager.getStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/types', async (req, res) => {
  res.json([
    { value: 'file_create', label: '文件创建' },
    { value: 'file_modify', label: '文件修改' },
    { value: 'file_delete', label: '文件删除' },
    { value: 'sync_execute', label: '同步执行' },
    { value: 'sync_skip', label: '同步跳过' },
    { value: 'conflict_detect', label: '冲突检测' },
    { value: 'conflict_resolve', label: '冲突解决' },
    { value: 'system_start', label: '系统启动' },
    { value: 'system_stop', label: '系统停止' },
    { value: 'sync_cycle_start', label: '同步周期开始' },
    { value: 'sync_cycle_end', label: '同步周期结束' },
  ]);
});

export default router;
