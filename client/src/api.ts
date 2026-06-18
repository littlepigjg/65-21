import axios from 'axios';
import { SyncConfig, SyncStatus, SyncRecord, ConflictFile, ConflictDiff, EventQueryParams, EventQueryResult, EventTypeOption } from './types';

const api = axios.create({
  baseURL: '/api',
  timeout: 10000
});

export const configApi = {
  get: () => api.get<SyncConfig>('/config').then(r => r.data),
  update: (config: SyncConfig) => api.put<SyncConfig>('/config', config).then(r => r.data),
  restart: () => api.post('/config/restart').then(r => r.data)
};

export const syncApi = {
  getStatus: () => api.get<SyncStatus>('/sync/status').then(r => r.data),
  start: () => api.post<SyncStatus>('/sync/start').then(r => r.data),
  stop: () => api.post<SyncStatus>('/sync/stop').then(r => r.data),
  syncNow: () => api.post<SyncStatus>('/sync/sync').then(r => r.data)
};

export const conflictsApi = {
  getAll: (all = false) => api.get<ConflictFile[]>(`/conflicts?all=${all}`).then(r => r.data),
  getById: (id: string) => api.get<ConflictFile>(`/conflicts/${id}`).then(r => r.data),
  getDiff: (id: string) => api.get<ConflictDiff>(`/conflicts/${id}/diff`).then(r => r.data),
  resolve: (id: string, resolution: 'source' | 'target' | 'merge', mergedContent?: string) =>
    api.post(`/conflicts/${id}/resolve`, { resolution, mergedContent }).then(r => r.data)
};

export const recordsApi = {
  getAll: (limit?: number) =>
    api.get<SyncRecord[]>(`/records${limit ? `?limit=${limit}` : ''}`).then(r => r.data),
  getRecent: (limit?: number) =>
    api.get<SyncRecord[]>(`/records/recent${limit ? `?limit=${limit}` : ''}`).then(r => r.data)
};

export const eventsApi = {
  query: (params: EventQueryParams) => {
    const searchParams = new URLSearchParams();
    if (params.startTime !== undefined) searchParams.append('startTime', String(params.startTime));
    if (params.endTime !== undefined) searchParams.append('endTime', String(params.endTime));
    if (params.filePath) searchParams.append('filePath', params.filePath);
    if (params.eventTypes && params.eventTypes.length > 0) searchParams.append('eventTypes', params.eventTypes.join(','));
    if (params.status) searchParams.append('status', params.status);
    if (params.sourceSide) searchParams.append('sourceSide', params.sourceSide);
    if (params.limit !== undefined) searchParams.append('limit', String(params.limit));
    if (params.offset !== undefined) searchParams.append('offset', String(params.offset));
    if (params.aggregate) searchParams.append('aggregate', params.aggregate);
    if (params.sample !== undefined) searchParams.append('sample', String(params.sample));
    return api.get<EventQueryResult>(`/events?${searchParams.toString()}`).then(r => r.data);
  },
  getTimeRange: () =>
    api.get<{ start: number; end: number; total: number }>('/events/time-range').then(r => r.data),
  getStats: () =>
    api.get<{ totalEvents: number; datesWithLogs: number; logFiles: number }>('/events/stats').then(r => r.data),
  getTypes: () =>
    api.get<EventTypeOption[]>('/events/types').then(r => r.data),
};

export function createEventSource(): EventSource {
  return new EventSource('/api/sync/events');
}
