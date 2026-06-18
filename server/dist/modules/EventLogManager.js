"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventLogManager = void 0;
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
const LOGS_DIR = path_1.default.join(process.cwd(), 'data', 'event-logs');
const INDEX_FILE = path_1.default.join(LOGS_DIR, '_index.json');
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const WRITE_BUFFER_FLUSH_INTERVAL = 1000;
const MAX_BUFFER_SIZE = 500;
class EventLogManager {
    constructor() {
        this.initialized = false;
        this.writeBuffer = [];
        this.flushTimer = null;
        this.currentDateKey = '';
        this.currentFileIndex = 0;
        this.currentFilePath = '';
        this.currentFileSize = 0;
        this.currentFileCount = 0;
        this.index = { dates: {}, totalEvents: 0, lastUpdated: 0 };
        this.indexDirty = false;
        this.indexSaveTimer = null;
    }
    async init() {
        if (this.initialized)
            return;
        await fs_extra_1.default.ensureDir(LOGS_DIR);
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
    async loadIndex() {
        try {
            if (await fs_extra_1.default.pathExists(INDEX_FILE)) {
                this.index = await fs_extra_1.default.readJson(INDEX_FILE);
            }
        }
        catch (e) {
            console.error('[EventLogManager] Failed to load index, creating new one', e);
            this.index = { dates: {}, totalEvents: 0, lastUpdated: 0 };
        }
    }
    async saveIndex() {
        this.index.lastUpdated = Date.now();
        await fs_extra_1.default.writeJson(INDEX_FILE, this.index, { spaces: 0 });
        this.indexDirty = false;
    }
    async saveIndexIfDirty() {
        if (this.indexDirty) {
            await this.saveIndex();
        }
    }
    getDateKey(timestamp) {
        const d = new Date(timestamp);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    computeCurrentFile() {
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
            this.currentFilePath = path_1.default.join(LOGS_DIR, lastFile.name);
            this.currentFileSize = lastFile.size;
            this.currentFileCount = lastFile.count;
        }
        else {
            this.currentFileIndex = dayIndex.files.length;
            const fileName = `events-${dateKey}-${String(this.currentFileIndex).padStart(3, '0')}.log`;
            this.currentFilePath = path_1.default.join(LOGS_DIR, fileName);
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
    rotateIfNeeded() {
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
    record(event) {
        const fullEvent = {
            id: (0, uuid_1.v4)(),
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
    async flushBuffer() {
        if (this.writeBuffer.length === 0)
            return;
        const events = [...this.writeBuffer];
        this.writeBuffer = [];
        try {
            for (const event of events) {
                await this.writeEventToDisk(event);
            }
        }
        catch (e) {
            console.error('[EventLogManager] Failed to flush buffer:', e);
            this.writeBuffer.unshift(...events);
        }
    }
    async writeEventToDisk(event) {
        this.rotateIfNeeded();
        const line = JSON.stringify(event) + '\n';
        const lineBytes = Buffer.byteLength(line, 'utf8');
        await fs_extra_1.default.appendFile(this.currentFilePath, line, 'utf8');
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
    getCandidateFiles(startTime, endTime) {
        const candidates = [];
        const startDate = this.getDateKey(startTime);
        const endDate = this.getDateKey(endTime);
        for (const [dateKey, dayIndex] of Object.entries(this.index.dates)) {
            if (dateKey < startDate || dateKey > endDate)
                continue;
            for (const file of dayIndex.files) {
                if (file.endTimestamp < startTime || file.startTimestamp > endTime)
                    continue;
                candidates.push(path_1.default.join(LOGS_DIR, file.name));
            }
        }
        return candidates.sort();
    }
    async readEventsFromFile(filePath) {
        const events = [];
        try {
            if (!(await fs_extra_1.default.pathExists(filePath)))
                return events;
            const content = await fs_extra_1.default.readFile(filePath, 'utf8');
            const lines = content.split('\n').filter((l) => l.trim().length > 0);
            for (const line of lines) {
                try {
                    events.push(JSON.parse(line));
                }
                catch { }
            }
        }
        catch (e) {
            console.error(`[EventLogManager] Failed to read ${filePath}:`, e);
        }
        return events;
    }
    filterEvents(events, params) {
        return events.filter((e) => {
            if (params.startTime !== undefined && e.timestamp < params.startTime)
                return false;
            if (params.endTime !== undefined && e.timestamp > params.endTime)
                return false;
            if (params.filePath) {
                if (!e.filePath)
                    return false;
                if (!e.filePath.toLowerCase().includes(params.filePath.toLowerCase()))
                    return false;
            }
            if (params.eventTypes && params.eventTypes.length > 0) {
                if (!params.eventTypes.includes(e.type))
                    return false;
            }
            if (params.status && e.status !== params.status)
                return false;
            if (params.sourceSide && e.sourceSide !== params.sourceSide)
                return false;
            return true;
        });
    }
    sampleEvents(events, sampleRate) {
        if (sampleRate <= 1)
            return events;
        return events.filter((_, i) => i % sampleRate === 0);
    }
    buildHourlyAggregates(events) {
        const buckets = new Map();
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
    async query(params) {
        await this.flushBuffer();
        await this.saveIndexIfDirty();
        const now = Date.now();
        const startTime = params.startTime ?? 0;
        const endTime = params.endTime ?? now;
        const candidateFiles = this.getCandidateFiles(startTime, endTime);
        let allEvents = [];
        for (const filePath of candidateFiles) {
            const fileEvents = await this.readEventsFromFile(filePath);
            const filtered = this.filterEvents(fileEvents, { ...params, startTime, endTime });
            allEvents = allEvents.concat(filtered);
        }
        allEvents.sort((a, b) => a.timestamp - b.timestamp);
        const total = allEvents.length;
        const aggregates = params.aggregate === 'hourly' || params.aggregate === 'daily'
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
    async getTimeRange() {
        await this.saveIndexIfDirty();
        let minTs = Infinity;
        let maxTs = 0;
        for (const dayIndex of Object.values(this.index.dates)) {
            for (const f of dayIndex.files) {
                if (f.startTimestamp < minTs)
                    minTs = f.startTimestamp;
                if (f.endTimestamp > maxTs)
                    maxTs = f.endTimestamp;
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
    async shutdown() {
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
    recordFileCreate(filePath, sourceSide, fileHash, fileSize, status = 'success', result) {
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
    recordFileModify(filePath, sourceSide, fileHash, previousHash, fileSize, status = 'success', result) {
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
    recordFileDelete(filePath, sourceSide, previousHash, status = 'success', result) {
        return this.record({
            type: 'file_delete',
            filePath,
            sourceSide,
            status,
            result,
            previousHash,
        });
    }
    recordSyncExecute(filePath, direction, action, status, result, details) {
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
    recordSyncSkip(filePath, reason, direction) {
        return this.record({
            type: 'sync_skip',
            filePath,
            status: 'skipped',
            result: reason,
            syncDirection: direction,
            details: { reason },
        });
    }
    recordConflictDetect(filePath, sourceHash, targetHash, details) {
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
    recordConflictResolve(filePath, resolution, status = 'success', result, operator = 'system') {
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
    recordSystemStart() {
        return this.record({
            type: 'system_start',
            status: 'success',
            result: 'Sync engine started',
        });
    }
    recordSystemStop() {
        return this.record({
            type: 'system_stop',
            status: 'success',
            result: 'Sync engine stopped',
        });
    }
    recordSyncCycleStart(changeCount) {
        return this.record({
            type: 'sync_cycle_start',
            status: 'info',
            result: `Starting sync cycle with ${changeCount} pending changes`,
            details: { pendingChanges: changeCount },
        });
    }
    recordSyncCycleEnd(processedCount, conflictCount) {
        return this.record({
            type: 'sync_cycle_end',
            status: 'success',
            result: `Sync cycle completed: ${processedCount} processed, ${conflictCount} conflicts`,
            details: { processedCount, conflictCount },
        });
    }
}
exports.eventLogManager = new EventLogManager();
//# sourceMappingURL=EventLogManager.js.map