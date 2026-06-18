import { AuditEvent, AuditEventType, AuditEventStatus, EventQueryParams, EventQueryResult } from '../types';
declare class EventLogManager {
    private initialized;
    private writeBuffer;
    private flushTimer;
    private currentDateKey;
    private currentFileIndex;
    private currentFilePath;
    private currentFileSize;
    private currentFileCount;
    private index;
    private indexDirty;
    private indexSaveTimer;
    init(): Promise<void>;
    private loadIndex;
    private saveIndex;
    private saveIndexIfDirty;
    private getDateKey;
    private computeCurrentFile;
    private rotateIfNeeded;
    record(event: Omit<AuditEvent, 'id' | 'timestamp'> & {
        timestamp?: number;
    }): AuditEvent;
    private flushBuffer;
    private writeEventToDisk;
    private getCandidateFiles;
    private readEventsFromFile;
    private filterEvents;
    private sampleEvents;
    private buildHourlyAggregates;
    query(params: EventQueryParams): Promise<EventQueryResult>;
    getTimeRange(): Promise<{
        start: number;
        end: number;
        total: number;
    }>;
    getStats(): Promise<{
        totalEvents: number;
        datesWithLogs: number;
        logFiles: number;
    }>;
    shutdown(): Promise<void>;
    recordFileCreate(filePath: string, sourceSide: 'source' | 'target', fileHash: string, fileSize: number, status?: AuditEventStatus, result?: string): AuditEvent;
    recordFileModify(filePath: string, sourceSide: 'source' | 'target', fileHash: string, previousHash: string | undefined, fileSize: number, status?: AuditEventStatus, result?: string): AuditEvent;
    recordFileDelete(filePath: string, sourceSide: 'source' | 'target' | 'both', previousHash: string | undefined, status?: AuditEventStatus, result?: string): AuditEvent;
    recordSyncExecute(filePath: string, direction: 'source-to-target' | 'target-to-source' | 'none', action: string, status: AuditEventStatus, result?: string, details?: Record<string, any>): AuditEvent;
    recordSyncSkip(filePath: string, reason: string, direction?: 'source-to-target' | 'target-to-source' | 'none'): AuditEvent;
    recordConflictDetect(filePath: string, sourceHash: string, targetHash: string, details?: Record<string, any>): AuditEvent;
    recordConflictResolve(filePath: string, resolution: 'source' | 'target' | 'merge', status?: AuditEventStatus, result?: string, operator?: 'system' | 'manual'): AuditEvent;
    recordSystemStart(): AuditEvent;
    recordSystemStop(): AuditEvent;
    recordSyncCycleStart(changeCount: number): AuditEvent;
    recordSyncCycleEnd(processedCount: number, conflictCount: number): AuditEvent;
}
export declare const eventLogManager: EventLogManager;
export { AuditEventType, AuditEventStatus };
