export interface SyncConfig {
  sourceDir: string;
  targetDir: string;
  syncInterval: number;
  ignoredPatterns: string[];
  autoResolve: boolean;
  conflictStrategy: 'latest' | 'source' | 'target' | 'manual';
}

export interface FileState {
  path: string;
  hash: string;
  size: number;
  mtime: number;
  source: 'source' | 'target';
}

export interface SyncRecord {
  id: string;
  timestamp: number;
  action: 'copy' | 'delete' | 'update' | 'conflict';
  filePath: string;
  source: 'source' | 'target';
  status: 'success' | 'failed' | 'pending';
  message?: string;
}

export interface ConflictFile {
  id: string;
  filePath: string;
  sourceVersion: FileState;
  targetVersion: FileState;
  detectedAt: number;
  resolved: boolean;
  resolution?: 'source' | 'target' | 'merge';
  resolvedAt?: number;
}

export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  lineNumber: number;
}

export interface DiffResult {
  additions: number;
  removals: number;
  lines: DiffLine[];
}

export interface SideBySideLine {
  content: string;
  type: string;
  lineNumber: number;
}

export interface ConflictDiff {
  conflict: ConflictFile;
  sourceContent: string;
  targetContent: string;
  diff: DiffResult;
  sideBySide: {
    left: SideBySideLine[];
    right: SideBySideLine[];
  };
}

export interface SyncStatus {
  isRunning: boolean;
  sourceDir: string;
  targetDir: string;
  lastSyncTime: number;
  pendingSyncCount: number;
  conflictCount: number;
  totalFiles: number;
  recentRecords: SyncRecord[];
}

export type AuditEventType =
  | 'file_create'
  | 'file_modify'
  | 'file_delete'
  | 'sync_execute'
  | 'sync_skip'
  | 'conflict_detect'
  | 'conflict_resolve'
  | 'system_start'
  | 'system_stop'
  | 'sync_cycle_start'
  | 'sync_cycle_end';

export type AuditEventStatus = 'success' | 'failed' | 'pending' | 'skipped' | 'info';

export interface AuditEvent {
  id: string;
  timestamp: number;
  type: AuditEventType;
  filePath?: string;
  sourceSide?: 'source' | 'target' | 'both';
  status: AuditEventStatus;
  result?: string;
  details?: Record<string, any>;
  syncDirection?: 'source-to-target' | 'target-to-source' | 'none';
  conflictResolution?: 'source' | 'target' | 'merge';
  fileHash?: string;
  fileSize?: number;
  previousHash?: string;
  operator?: 'system' | 'manual';
}

export interface EventQueryParams {
  startTime?: number;
  endTime?: number;
  filePath?: string;
  eventTypes?: AuditEventType[];
  status?: AuditEventStatus;
  sourceSide?: 'source' | 'target' | 'both';
  limit?: number;
  offset?: number;
  aggregate?: 'none' | 'hourly' | 'daily' | 'count';
  sample?: number;
}

export interface HourlyAggregate {
  hour: string;
  timestamp: number;
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
}

export interface EventQueryResult {
  events: AuditEvent[];
  total: number;
  hasMore: boolean;
  aggregates?: HourlyAggregate[];
  timeRange?: { start: number; end: number };
}

export interface EventTypeOption {
  value: AuditEventType;
  label: string;
}
