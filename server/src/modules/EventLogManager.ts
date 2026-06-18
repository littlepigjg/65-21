import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  AuditEvent,
  AuditEventType,
  AuditEventStatus,
  EventQueryParams,
  EventQueryResult,
  HourlyAggregate,
} from '../types';

const LOGS_DIR = path.join(process.cwd(), 'data', 'event-logs');
const INDEX_FILE = path.join(LOGS_DIR, '_index.json');
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const WRITE_BUFFER_FLUSH_INTERVAL = 1000;
const MAX_BUFFER_SIZE = 500;

interface LogFileIndex {
  date: string;
  files: Array<{
    name: string;
    startTimestamp: number;
    endTimestamp: number;
    count: number;
    size: number;
  }>;
}

interface IndexData {
  dates: Record<string, LogFileIndex>;
  totalEvents: number;
  lastUpdated: number;
}

class EventLogManager {
  private initialized = false;
  private writeBuffer: AuditEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private currentDateKey = '';
  private currentFileIndex = 0;
  private currentFilePath = '';
  private currentFileSize = 0;
  private currentFileCount = 0;
  private index: IndexData = { dates: {}, totalEvents: 0, lastUpdated: 0 };
  private indexDirty = false;
  private indexSaveTimer: NodeJS.Timeout | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;

    await fs.ensureDir(LOGS_DIR);

    await this.loadIndex();
    this.computeCurrentFile();

    this.flushTimer = setInterval(() => {
      void this.flushBuffer();
    }, WRITE_BUFFER_FLUSH_INTERVAL);
    this.flushTimer.unref();

    this.indexSaveTimer = setInterval(() => {
      void this.saveIndexIfDirty();
    }, 5000);
    this.indexSaveTimer.unref();

    this.initialized = true;
    console.log('[EventLogManager] Initialized');
  }

  private async loadIndex(): Promise<void> {
    try {
      if (await fs.pathExists(INDEX_FILE)) {
        this.index = await fs.readJson(INDEX_FILE);
      }
    } catch (e) {
      console.error('[EventLogManager] Failed to load index, creating new one', e);
      this.index = { dates: {}, totalEvents: 0, lastUpdated: 0 };
    }
  }

  private async saveIndex(): Promise<void> {
    this.index.lastUpdated = Date.now();
    await fs.writeJson(INDEX_FILE, this.index, { spaces: 0 });
    this.indexDirty = false;
  }

  private async saveIndexIfDirty(): Promise<void> {
    if (this.indexDirty) {
      await this.saveIndex();
    }
  }

  private getDateKey(timestamp: number): string {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private computeCurrentFile(): void {
    const now = Date.now();
    const dateKey = this.getDateKey(now);

    if (dateKey !== this.currentDateKey) {
      this.currentDateKey = dateKey;
      this.currentFileIndex = 0;
    }

    if (!this.index.dates[dateKey]) {
      this.index.dates[dateKey] = { date: dateKey, files: [] };
      this.indexDirty = true;
    }

    const dayIndex = this.index.dates[dateKey];
    const lastFile = dayIndex.files[dayIndex.files.length - 1];

    if (lastFile && lastFile.size < MAX_FILE_SIZE_BYTES) {
      this.currentFileIndex = dayIndex.files.length - 1;
      this.currentFilePath = path.join(LOGS_DIR, lastFile.name);
      this.currentFileSize = lastFile.size;
      this.currentFileCount = lastFile.count;
    } else {
      this.currentFileIndex = dayIndex.files.length;
      const fileName = `events-${dateKey}-${String(this.currentFileIndex).padStart(3, '0')}.log`;
      this.currentFilePath = path.join(LOGS_DIR, fileName);
      this.currentFileSize = 0;
      this.currentFileCount = 0;
      dayIndex.files.push({
        name: fileName,
        startTimestamp: now,
        endTimestamp: now,
        count: 0,
        size: 0,
      });
      this.indexDirty = true;
    }
  }

  private rotateIfNeeded(): void {
    const now = Date.now();
    const dateKey = this.getDateKey(now);

    if (dateKey !== this.currentDateKey || this.currentFileSize >= MAX_FILE_SIZE_BYTES) {
      if (this.currentFileSize >= MAX_FILE_SIZE_BYTES) {
        const dayIndex = this.index.dates[this.currentDateKey];
        if (dayIndex) {
          const f = dayIndex.files[this.currentFileIndex];
          if (f) {
            f.endTimestamp = now;
          }
        }
      }
      this.computeCurrentFile();
    }
  }

  record(event: Omit<AuditEvent, 'id' | 'timestamp'> & { timestamp?: number }): AuditEvent {
    const fullEvent: AuditEvent = {
      id: uuidv4(),
      timestamp: event.timestamp ?? Date.now(),
      type: event.type,
      filePath: event.filePath,
      sourceSide: event.sourceSide,
      status: event.status,
      result: event.result,
      details: event.details,
      syncDirection: event.syncDirection,
      conflictResolution: event.conflictResolution,
      fileHash: event.fileHash,
      fileSize: event.fileSize,
      previousHash: event.previousHash,
      operator: event.operator ?? 'system',
    };

    this.writeBuffer.push(fullEvent);
    if (this.writeBuffer.length >= MAX_BUFFER_SIZE) {
      void this.flushBuffer();
    }

    return fullEvent;
  }

  private async flushBuffer(): Promise<void> {
    if (this.writeBuffer.length === 0) return;

    const events = [...this.writeBuffer];
    this.writeBuffer = [];

    try {
      for (const event of events) {
        await this.writeEventToDisk(event);
      }
    } catch (e) {
      console.error('[EventLogManager] Failed to flush buffer:', e);
      this.writeBuffer.unshift(...events);
    }
  }

  private async writeEventToDisk(event: AuditEvent): Promise<void> {
    this.rotateIfNeeded();

    const line = JSON.stringify(event) + '\n';
    const lineBytes = Buffer.byteLength(line, 'utf8');

    await fs.appendFile(this.currentFilePath, line, 'utf8');

    this.currentFileSize += lineBytes;
    this.currentFileCount++;
    this.index.totalEvents++;

    const dayIndex = this.index.dates[this.currentDateKey];
    const fileMeta = dayIndex.files[this.currentFileIndex];
    if (fileMeta) {
      fileMeta.count = this.currentFileCount;
      fileMeta.size = this.currentFileSize;
      if (event.timestamp < fileMeta.startTimestamp) {
        fileMeta.startTimestamp = event.timestamp;
      }
      if (event.timestamp > fileMeta.endTimestamp) {
        fileMeta.endTimestamp = event.timestamp;
      }
    }

    this.indexDirty = true;
  }

  private getCandidateFiles(startTime: number, endTime: number): string[] {
    const candidates: string[] = [];
    const startDate = this.getDateKey(startTime);
    const endDate = this.getDateKey(endTime);

    for (const [dateKey, dayIndex] of Object.entries(this.index.dates)) {
      if (dateKey < startDate || dateKey > endDate) continue;

      for (const file of dayIndex.files) {
        if (file.endTimestamp < startTime || file.startTimestamp > endTime) continue;
        candidates.push(path.join(LOGS_DIR, file.name));
      }
    }

    return candidates.sort();
  }

  private async readEventsFromFile(filePath: string): Promise<AuditEvent[]> {
    const events: AuditEvent[] = [];
    try {
      if (!(await fs.pathExists(filePath))) return events;
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n').filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          events.push(JSON.parse(line));
        } catch {}
      }
    } catch (e) {
      console.error(`[EventLogManager] Failed to read ${filePath}:`, e);
    }
    return events;
  }

  private filterEvents(events: AuditEvent[], params: EventQueryParams): AuditEvent[] {
    return events.filter((e) => {
      if (params.startTime !== undefined && e.timestamp < params.startTime) return false;
      if (params.endTime !== undefined && e.timestamp > params.endTime) return false;
      if (params.filePath) {
        if (!e.filePath) return false;
        if (!e.filePath.toLowerCase().includes(params.filePath.toLowerCase())) return false;
      }
      if (params.eventTypes && params.eventTypes.length > 0) {
        if (!params.eventTypes.includes(e.type)) return false;
      }
      if (params.status && e.status !== params.status) return false;
      if (params.sourceSide && e.sourceSide !== params.sourceSide) return false;
      return true;
    });
  }

  private sampleEvents(events: AuditEvent[], sampleRate: number): AuditEvent[] {
    if (sampleRate <= 1) return events;
    return events.filter((_, i) => i % sampleRate === 0);
  }

  private buildHourlyAggregates(events: AuditEvent[]): HourlyAggregate[] {
    const buckets = new Map<string, HourlyAggregate>();

    for (const e of events) {
      const d = new Date(e.timestamp);
      const hourKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
      const hourTs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();

      let agg = buckets.get(hourKey);
      if (!agg) {
        agg = {
          hour: hourKey,
          timestamp: hourTs,
          total: 0,
          byType: {},
          byStatus: {},
        };
        buckets.set(hourKey, agg);
      }

      agg.total++;
      agg.byType[e.type] = (agg.byType[e.type] || 0) + 1;
      agg.byStatus[e.status] = (agg.byStatus[e.status] || 0) + 1;
    }

    return Array.from(buckets.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  async query(params: EventQueryParams): Promise<EventQueryResult> {
    await this.flushBuffer();
    await this.saveIndexIfDirty();

    const now = Date.now();
    const startTime = params.startTime ?? 0;
    const endTime = params.endTime ?? now;

    const candidateFiles = this.getCandidateFiles(startTime, endTime);
    let allEvents: AuditEvent[] = [];

    for (const filePath of candidateFiles) {
      const fileEvents = await this.readEventsFromFile(filePath);
      const filtered = this.filterEvents(fileEvents, { ...params, startTime, endTime });
      allEvents = allEvents.concat(filtered);
    }

    allEvents.sort((a, b) => a.timestamp - b.timestamp);

    const total = allEvents.length;

    const aggregates =
      params.aggregate === 'hourly' || params.aggregate === 'daily'
        ? this.buildHourlyAggregates(allEvents)
        : undefined;

    if (params.sample && params.sample > 1) {
      allEvents = this.sampleEvents(allEvents, params.sample);
    }

    const offset = params.offset ?? 0;
    const limit = params.limit ?? 1000;
    const pagedEvents = allEvents.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    return {
      events: pagedEvents,
      total,
      hasMore,
      aggregates,
      timeRange: { start: startTime, end: endTime },
    };
  }

  async getTimeRange(): Promise<{ start: number; end: number; total: number }> {
    await this.saveIndexIfDirty();
    let minTs = Infinity;
    let maxTs = 0;

    for (const dayIndex of Object.values(this.index.dates)) {
      for (const f of dayIndex.files) {
        if (f.startTimestamp < minTs) minTs = f.startTimestamp;
        if (f.endTimestamp > maxTs) maxTs = f.endTimestamp;
      }
    }

    return {
      start: minTs === Infinity ? 0 : minTs,
      end: maxTs === 0 ? Date.now() : maxTs,
      total: this.index.totalEvents,
    };
  }

  async getStats() {
    await this.saveIndexIfDirty();
    return {
      totalEvents: this.index.totalEvents,
      datesWithLogs: Object.keys(this.index.dates).length,
      logFiles: Object.values(this.index.dates).reduce((sum, d) => sum + d.files.length, 0),
    };
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.indexSaveTimer) {
      clearInterval(this.indexSaveTimer);
      this.indexSaveTimer = null;
    }
    await this.flushBuffer();
    await this.saveIndex();
    this.initialized = false;
  }

  recordFileCreate(
    filePath: string,
    sourceSide: 'source' | 'target',
    fileHash: string,
    fileSize: number,
    status: AuditEventStatus = 'success',
    result?: string,
  ): AuditEvent {
    return this.record({
      type: 'file_create',
      filePath,
      sourceSide,
      status,
      result,
      fileHash,
      fileSize,
    });
  }

  recordFileModify(
    filePath: string,
    sourceSide: 'source' | 'target',
    fileHash: string,
    previousHash: string | undefined,
    fileSize: number,
    status: AuditEventStatus = 'success',
    result?: string,
  ): AuditEvent {
    return this.record({
      type: 'file_modify',
      filePath,
      sourceSide,
      status,
      result,
      fileHash,
      previousHash,
      fileSize,
    });
  }

  recordFileDelete(
    filePath: string,
    sourceSide: 'source' | 'target' | 'both',
    previousHash: string | undefined,
    status: AuditEventStatus = 'success',
    result?: string,
  ): AuditEvent {
    return this.record({
      type: 'file_delete',
      filePath,
      sourceSide,
      status,
      result,
      previousHash,
    });
  }

  recordSyncExecute(
    filePath: string,
    direction: 'source-to-target' | 'target-to-source' | 'none',
    action: string,
    status: AuditEventStatus,
    result?: string,
    details?: Record<string, any>,
  ): AuditEvent {
    return this.record({
      type: 'sync_execute',
      filePath,
      sourceSide: direction === 'source-to-target' ? 'source' : direction === 'target-to-source' ? 'target' : 'both',
      status,
      result,
      details,
      syncDirection: direction,
    });
  }

  recordSyncSkip(
    filePath: string,
    reason: string,
    direction?: 'source-to-target' | 'target-to-source' | 'none',
  ): AuditEvent {
    return this.record({
      type: 'sync_skip',
      filePath,
      status: 'skipped',
      result: reason,
      syncDirection: direction,
      details: { reason },
    });
  }

  recordConflictDetect(
    filePath: string,
    sourceHash: string,
    targetHash: string,
    details?: Record<string, any>,
  ): AuditEvent {
    return this.record({
      type: 'conflict_detect',
      filePath,
      sourceSide: 'both',
      status: 'info',
      result: 'Conflict detected between source and target',
      fileHash: sourceHash,
      previousHash: targetHash,
      details,
    });
  }

  recordConflictResolve(
    filePath: string,
    resolution: 'source' | 'target' | 'merge',
    status: AuditEventStatus = 'success',
    result?: string,
    operator: 'system' | 'manual' = 'system',
  ): AuditEvent {
    return this.record({
      type: 'conflict_resolve',
      filePath,
      sourceSide: 'both',
      status,
      result,
      conflictResolution: resolution,
      operator,
    });
  }

  recordSystemStart(): AuditEvent {
    return this.record({
      type: 'system_start',
      status: 'success',
      result: 'Sync engine started',
    });
  }

  recordSystemStop(): AuditEvent {
    return this.record({
      type: 'system_stop',
      status: 'success',
      result: 'Sync engine stopped',
    });
  }

  recordSyncCycleStart(changeCount: number): AuditEvent {
    return this.record({
      type: 'sync_cycle_start',
      status: 'info',
      result: `Starting sync cycle with ${changeCount} pending changes`,
      details: { pendingChanges: changeCount },
    });
  }

  recordSyncCycleEnd(processedCount: number, conflictCount: number): AuditEvent {
    return this.record({
      type: 'sync_cycle_end',
      status: 'success',
      result: `Sync cycle completed: ${processedCount} processed, ${conflictCount} conflicts`,
      details: { processedCount, conflictCount },
    });
  }
}

export const eventLogManager = new EventLogManager();
export { AuditEventType, AuditEventStatus };
