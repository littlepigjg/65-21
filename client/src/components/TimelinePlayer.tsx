import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { eventsApi } from '../api';
import {
  AuditEvent,
  AuditEventType,
  AuditEventStatus,
  EventTypeOption,
  HourlyAggregate,
} from '../types';

const EVENT_TYPE_META: Record<AuditEventType, { label: string; color: string; icon: string }> = {
  file_create: { label: '创建', color: '#48bb78', icon: '📄' },
  file_modify: { label: '修改', color: '#4299e1', icon: '✏️' },
  file_delete: { label: '删除', color: '#f56565', icon: '🗑️' },
  sync_execute: { label: '同步', color: '#805ad5', icon: '🔄' },
  sync_skip: { label: '跳过', color: '#a0aec0', icon: '⏭️' },
  conflict_detect: { label: '冲突', color: '#ed8936', icon: '⚠️' },
  conflict_resolve: { label: '解冲突', color: '#38b2ac', icon: '✅' },
  system_start: { label: '启动', color: '#38a169', icon: '▶️' },
  system_stop: { label: '停止', color: '#e53e3e', icon: '⏹️' },
  sync_cycle_start: { label: '周期开始', color: '#667eea', icon: '🚀' },
  sync_cycle_end: { label: '周期结束', color: '#5a67d8', icon: '🏁' },
};

const STATUS_META: Record<AuditEventStatus, { label: string; class: string }> = {
  success: { label: '成功', class: 'badge-success' },
  failed: { label: '失败', class: 'badge-danger' },
  pending: { label: '进行中', class: 'badge-warning' },
  skipped: { label: '跳过', class: 'badge-info' },
  info: { label: '信息', class: 'badge-info' },
};

type ViewMode = 'timeline' | 'list';
type AggregateMode = 'none' | 'hourly';

function formatTime(ts: number): string {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatTimeShort(ts: number): string {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.floor(ms / 1000)}秒`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}分${Math.floor((ms % 60000) / 1000)}秒`;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}时${m}分`;
}

export default function TimelinePlayer() {
  const [eventTypeOptions, setEventTypeOptions] = useState<EventTypeOption[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [aggregates, setAggregates] = useState<HourlyAggregate[]>([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [loading, setLoading] = useState(false);
  const [globalStart, setGlobalStart] = useState(0);
  const [globalEnd, setGlobalEnd] = useState(Date.now());
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(0);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1);
  const playTimerRef = useRef<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [aggregateMode, setAggregateMode] = useState<AggregateMode>('none');
  const [sampleRate, setSampleRate] = useState(1);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [filterTypes, setFilterTypes] = useState<AuditEventType[]>([]);
  const [filterStatus, setFilterStatus] = useState<AuditEventStatus | ''>('');
  const [filterSource, setFilterSource] = useState<'' | 'source' | 'target' | 'both'>('');
  const [searchPath, setSearchPath] = useState('');
  const timelineRef = useRef<HTMLDivElement>(null);
  const isDraggingTimeline = useRef(false);
  const dragStartX = useRef(0);
  const dragStartViewStart = useRef(0);
  const dragStartViewEnd = useRef(0);
  const [stats, setStats] = useState({ totalEvents: 0, datesWithLogs: 0, logFiles: 0 });

  const loadInitialData = useCallback(async () => {
    try {
      const [range, types, statsData] = await Promise.all([
        eventsApi.getTimeRange(),
        eventsApi.getTypes(),
        eventsApi.getStats(),
      ]);
      setEventTypeOptions(types);
      setGlobalStart(range.start || Date.now() - 86400000);
      setGlobalEnd(range.end || Date.now());
      const initialEnd = range.end || Date.now();
      const initialDuration = Math.min(initialEnd - (range.start || 0), 3600000);
      setViewStart(initialEnd - initialDuration);
      setViewEnd(initialEnd);
      setPlayheadTime(initialEnd);
      setStats(statsData);
    } catch (e) {
      console.error('Failed to load initial data', e);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    if (viewStart === 0 && viewEnd === 0) return;
    setLoading(true);
    try {
      const result = await eventsApi.query({
        startTime: viewStart,
        endTime: viewEnd,
        eventTypes: filterTypes.length > 0 ? filterTypes : undefined,
        status: filterStatus || undefined,
        sourceSide: filterSource || undefined,
        filePath: searchPath || undefined,
        limit: 5000,
        aggregate: aggregateMode === 'hourly' ? 'hourly' : 'none',
        sample: sampleRate > 1 ? sampleRate : undefined,
      });
      setEvents(result.events);
      setAggregates(result.aggregates || []);
      setTotalEvents(result.total);
    } catch (e) {
      console.error('Failed to load events', e);
    } finally {
      setLoading(false);
    }
  }, [viewStart, viewEnd, filterTypes, filterStatus, filterSource, searchPath, aggregateMode, sampleRate]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (viewStart > 0 && viewEnd > 0) {
      loadEvents();
    }
  }, [loadEvents, viewStart, viewEnd]);

  useEffect(() => {
    if (isPlaying) {
      const speedFactor = playSpeed;
      const stepMs = 50;
      playTimerRef.current = window.setInterval(() => {
        setPlayheadTime((prev) => {
          const next = prev + stepMs * speedFactor * 10;
          if (next >= viewEnd) {
            setIsPlaying(false);
            return viewEnd;
          }
          return next;
        });
      }, stepMs);
    } else {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
    }
    return () => {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
      }
    };
  }, [isPlaying, playSpeed, viewEnd]);

  const eventsAtPlayhead = useMemo(() => {
    return events.filter((e) => e.timestamp <= playheadTime);
  }, [events, playheadTime]);

  const visibleEventBuckets = useMemo(() => {
    const buckets = new Map<string, AuditEvent[]>();
    const range = viewEnd - viewStart;
    const bucketCount = 60;
    const bucketSize = range / bucketCount;

    for (const e of events) {
      const idx = Math.min(bucketCount - 1, Math.floor((e.timestamp - viewStart) / bucketSize));
      const key = String(idx);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(e);
    }
    return buckets;
  }, [events, viewStart, viewEnd]);

  const getTimePercent = (ts: number) => {
    const range = viewEnd - viewStart;
    if (range <= 0) return 0;
    return Math.max(0, Math.min(100, ((ts - viewStart) / range) * 100));
  };

  const xToTime = (clientX: number): number => {
    const el = timelineRef.current;
    if (!el) return viewStart;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return viewStart + pct * (viewEnd - viewStart);
  };

  const handleTimelineMouseDown = (e: React.MouseEvent) => {
    isDraggingTimeline.current = true;
    dragStartX.current = e.clientX;
    dragStartViewStart.current = viewStart;
    dragStartViewEnd.current = viewEnd;
    document.body.style.userSelect = 'none';
  };

  const handleTimelineMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDraggingTimeline.current) return;
      const el = timelineRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const dxPx = e.clientX - dragStartX.current;
      const dxRatio = dxPx / rect.width;
      const range = dragStartViewEnd.current - dragStartViewStart.current;
      const dxTime = dxRatio * range;
      const globalRange = globalEnd - globalStart;

      let newStart = dragStartViewStart.current - dxTime;
      let newEnd = dragStartViewEnd.current - dxTime;

      if (newStart < globalStart) {
        newStart = globalStart;
        newEnd = globalStart + range;
      }
      if (newEnd > globalEnd) {
        newEnd = globalEnd;
        newStart = globalEnd - range;
      }
      if (globalRange > 0) {
        setViewStart(Math.max(globalStart, newStart));
        setViewEnd(Math.min(globalEnd, newEnd));
      }
    },
    [globalStart, globalEnd],
  );

  const handleTimelineMouseUp = useCallback(() => {
    isDraggingTimeline.current = false;
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleTimelineMouseMove);
    window.addEventListener('mouseup', handleTimelineMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleTimelineMouseMove);
      window.removeEventListener('mouseup', handleTimelineMouseUp);
    };
  }, [handleTimelineMouseMove, handleTimelineMouseUp]);

  const handleTimelineClick = (e: React.MouseEvent) => {
    if (Math.abs(e.clientX - dragStartX.current) > 5) return;
    const t = xToTime(e.clientX);
    setPlayheadTime(t);
    setIsPlaying(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const range = viewEnd - viewStart;
    const globalRange = globalEnd - globalStart;
    const delta = e.deltaY > 0 ? 1.2 : 0.8;
    const mouseTime = xToTime(e.clientX);
    const leftRatio = (mouseTime - viewStart) / (range || 1);

    let newRange = range * delta;
    newRange = Math.max(60000, Math.min(globalRange, newRange));

    const leftPart = newRange * leftRatio;
    const rightPart = newRange * (1 - leftRatio);

    let newStart = mouseTime - leftPart;
    let newEnd = mouseTime + rightPart;

    if (newStart < globalStart) {
      newStart = globalStart;
      newEnd = globalStart + newRange;
    }
    if (newEnd > globalEnd) {
      newEnd = globalEnd;
      newStart = globalEnd - newRange;
    }

    setViewStart(Math.max(globalStart, newStart));
    setViewEnd(Math.min(globalEnd, newEnd));
    setZoomLevel((z) => z * (delta > 1 ? 1 / 1.2 : 1.2));
  };

  const handlePlayPause = () => {
    if (playheadTime >= viewEnd) {
      setPlayheadTime(viewStart);
    }
    setIsPlaying(!isPlaying);
  };

  const handleJumpToStart = () => {
    setPlayheadTime(viewStart);
    setIsPlaying(false);
  };

  const handleJumpToEnd = () => {
    setPlayheadTime(viewEnd);
    setIsPlaying(false);
  };

  const handleZoomIn = () => {
    const range = viewEnd - viewStart;
    const center = (viewStart + viewEnd) / 2;
    const newRange = Math.max(60000, range * 0.5);
    setViewStart(Math.max(globalStart, center - newRange / 2));
    setViewEnd(Math.min(globalEnd, center + newRange / 2));
  };

  const handleZoomOut = () => {
    const range = viewEnd - viewStart;
    const center = (viewStart + viewEnd) / 2;
    const globalRange = globalEnd - globalStart;
    const newRange = Math.min(globalRange, range * 2);
    setViewStart(Math.max(globalStart, center - newRange / 2));
    setViewEnd(Math.min(globalEnd, center + newRange / 2));
  };

  const handleFitAll = () => {
    setViewStart(globalStart);
    setViewEnd(globalEnd);
    setPlayheadTime(globalEnd);
  };

  const toggleFilterType = (t: AuditEventType) => {
    setFilterTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const setQuickRange = (preset: '1h' | '6h' | '24h' | '7d') => {
    const now = globalEnd || Date.now();
    const durations: Record<string, number> = {
      '1h': 3600000,
      '6h': 21600000,
      '24h': 86400000,
      '7d': 604800000,
    };
    const d = durations[preset];
    setViewEnd(now);
    setViewStart(Math.max(globalStart, now - d));
    setPlayheadTime(now);
  };

  return (
    <div className="timeline-player">
      <div className="card">
        <div className="card-header">
          <h2>🎬 历史事件回放</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span className="badge badge-info">共 {stats.totalEvents.toLocaleString()} 条事件</span>
            <span className="badge badge-info">{stats.datesWithLogs} 天日志</span>
          </div>
        </div>

        <div className="filter-bar">
          <div className="filter-group">
            <label>时间范围:</label>
            <button className="btn btn-sm" onClick={() => setQuickRange('1h')}>最近1小时</button>
            <button className="btn btn-sm" onClick={() => setQuickRange('6h')}>最近6小时</button>
            <button className="btn btn-sm" onClick={() => setQuickRange('24h')}>最近24小时</button>
            <button className="btn btn-sm" onClick={() => setQuickRange('7d')}>最近7天</button>
            <button className="btn btn-sm btn-primary" onClick={handleFitAll}>全部</button>
          </div>

          <div className="filter-group">
            <label>采样:</label>
            <select value={sampleRate} onChange={(e) => setSampleRate(Number(e.target.value))} className="input-sm">
              <option value={1}>原始</option>
              <option value={10}>10:1</option>
              <option value={100}>100:1</option>
              <option value={1000}>1000:1</option>
            </select>
            <label>聚合:</label>
            <select
              value={aggregateMode}
              onChange={(e) => setAggregateMode(e.target.value as AggregateMode)}
              className="input-sm"
            >
              <option value="none">逐条事件</option>
              <option value="hourly">每小时汇总</option>
            </select>
          </div>
        </div>

        <div className="filter-bar">
          <div className="filter-group">
            <label>搜索路径:</label>
            <input
              type="text"
              placeholder="输入文件路径关键字..."
              value={searchPath}
              onChange={(e) => setSearchPath(e.target.value)}
              className="input-sm"
              style={{ width: '260px' }}
            />
          </div>

          <div className="filter-group">
            <label>状态:</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as AuditEventStatus | '')}
              className="input-sm"
            >
              <option value="">全部</option>
              <option value="success">成功</option>
              <option value="failed">失败</option>
              <option value="skipped">跳过</option>
              <option value="info">信息</option>
            </select>
            <label>来源:</label>
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value as any)}
              className="input-sm"
            >
              <option value="">全部</option>
              <option value="source">源目录</option>
              <option value="target">目标目录</option>
              <option value="both">双向</option>
            </select>
          </div>
        </div>

        <div className="filter-type-chips">
          {eventTypeOptions.map((opt) => {
            const meta = EVENT_TYPE_META[opt.value];
            const active = filterTypes.includes(opt.value);
            return (
              <button
                key={opt.value}
                className={`chip ${active ? 'chip-active' : ''}`}
                onClick={() => toggleFilterType(opt.value)}
                style={active ? { backgroundColor: meta.color, color: '#fff', borderColor: meta.color } : {}}
              >
                <span>{meta.icon}</span> {opt.label}
              </button>
            );
          })}
          {filterTypes.length > 0 && (
            <button className="chip chip-clear" onClick={() => setFilterTypes([])}>
              ✕ 清除类型
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="player-controls">
          <div className="transport-controls">
            <button className="btn btn-icon" onClick={handleJumpToStart} title="跳到开始">
              ⏮
            </button>
            <button className="btn btn-icon btn-primary" onClick={handlePlayPause} title={isPlaying ? '暂停' : '播放'}>
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button className="btn btn-icon" onClick={handleJumpToEnd} title="跳到结束">
              ⏭
            </button>
            <select
              value={playSpeed}
              onChange={(e) => setPlaySpeed(Number(e.target.value))}
              className="input-sm speed-select"
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={5}>5x</option>
              <option value={10}>10x</option>
              <option value={50}>50x</option>
            </select>
          </div>

          <div className="view-controls">
            <div className="btn-group-mode">
              <button
                className={`btn btn-sm ${viewMode === 'timeline' ? 'btn-primary' : ''}`}
                onClick={() => setViewMode('timeline')}
              >
                📊 时间轴
              </button>
              <button
                className={`btn btn-sm ${viewMode === 'list' ? 'btn-primary' : ''}`}
                onClick={() => setViewMode('list')}
              >
                📋 列表
              </button>
            </div>
            <button className="btn btn-icon" onClick={handleZoomOut} title="缩小">
              🔍−
            </button>
            <button className="btn btn-icon" onClick={handleZoomIn} title="放大">
              🔍+
            </button>
          </div>
        </div>

        <div className="time-range-info">
          <span>查看范围: {formatTime(viewStart)}</span>
          <span>~</span>
          <span>{formatTime(viewEnd)}</span>
          <span className="duration-badge">时长 {formatDuration(viewEnd - viewStart)}</span>
          <span className="badge badge-info">过滤后 {totalEvents.toLocaleString()} 条</span>
          {loading && <span className="spinner-sm"></span>}
        </div>

        <div
          ref={timelineRef}
          className="timeline-container"
          onMouseDown={handleTimelineMouseDown}
          onClick={handleTimelineClick}
          onWheel={handleWheel}
        >
          <div className="timeline-ruler">
            {Array.from({ length: 11 }, (_, i) => {
              const t = viewStart + ((viewEnd - viewStart) * i) / 10;
              return (
                <div key={i} className="ruler-tick" style={{ left: `${i * 10}%` }}>
                  <div className="ruler-line"></div>
                  <div className="ruler-label">{formatTimeShort(t)}</div>
                </div>
              );
            })}
          </div>

          <div className="timeline-track">
            {aggregateMode === 'hourly' && aggregates.length > 0 ? (
              <div className="aggregates-bars">
                {aggregates.map((agg, i) => {
                  const left = getTimePercent(agg.timestamp);
                  const width = Math.max(1, getTimePercent(agg.timestamp + 3600000) - left);
                  const maxCount = Math.max(...aggregates.map((a) => a.total), 1);
                  const heightPct = (agg.total / maxCount) * 100;
                  return (
                    <div
                      key={i}
                      className="aggregate-bar"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        height: `${Math.max(8, heightPct)}%`,
                      }}
                      title={`${agg.hour} - ${agg.total} 条事件`}
                    >
                      <div className="aggregate-bar-count">{agg.total}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                {Array.from(visibleEventBuckets.entries()).map(([idx, bucketEvents]) => {
                  const range = viewEnd - viewStart;
                  const bucketSize = range / 60;
                  const bucketStart = viewStart + Number(idx) * bucketSize;
                  const left = getTimePercent(bucketStart);
                  const width = Math.max(2, (1 / 60) * 100);
                  const maxHeight = 120;
                  const height = Math.min(maxHeight, 6 + bucketEvents.length * 1.5);
                  const types = new Set(bucketEvents.map((e) => e.type));
                  const color =
                    types.size === 1
                      ? EVENT_TYPE_META[bucketEvents[0].type].color
                      : '#667eea';
                  return (
                    <div
                      key={idx}
                      className="event-bar"
                      style={{
                        left: `calc(${left}% )`,
                        width: `calc(${width}% - 1px)`,
                        height: `${height}px`,
                        backgroundColor: color,
                      }}
                      title={`${formatTime(bucketStart)} ~ ${bucketEvents.length} 条事件`}
                    >
                      {bucketEvents.length >= 5 && (
                        <span className="event-bar-count">{bucketEvents.length}</span>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            <div
              className="playhead"
              style={{ left: `${getTimePercent(playheadTime)}%` }}
            >
              <div className="playhead-line"></div>
              <div className="playhead-dot"></div>
              <div className="playhead-label">{formatTimeShort(playheadTime)}</div>
            </div>
          </div>

          <div className="timeline-legend">
            <div className="timeline-tip">💡 提示：滚轮缩放、左右拖动平移、点击定位播放头</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>
            {viewMode === 'timeline' ? '⏪ 回放中的事件' : '📋 事件列表'}（{eventsAtPlayhead.length.toLocaleString()}）
          </h3>
          {viewMode === 'timeline' && (
            <div className="playback-progress">
              进度: {formatDuration(playheadTime - viewStart)} / {formatDuration(viewEnd - viewStart)}
            </div>
          )}
        </div>

        {events.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🎞️</div>
            <h3>暂无事件记录</h3>
            <p>选择不同的时间范围或调整过滤条件</p>
          </div>
        ) : (
          <div className="event-list">
            {(viewMode === 'timeline' ? eventsAtPlayhead : events).map((event) => {
              const meta = EVENT_TYPE_META[event.type];
              return (
                <div
                  key={event.id}
                  className={`event-item ${selectedEvent?.id === event.id ? 'event-selected' : ''}`}
                  onClick={() => setSelectedEvent(event)}
                >
                  <div
                    className="event-type-bar"
                    style={{ backgroundColor: meta.color }}
                  ></div>
                  <div className="event-icon" style={{ backgroundColor: meta.color + '20', color: meta.color }}>
                    {meta.icon}
                  </div>
                  <div className="event-body">
                    <div className="event-header">
                      <span className="event-type-label" style={{ color: meta.color }}>
                        {meta.label}
                      </span>
                      <span className={`badge ${STATUS_META[event.status].class}`}>
                        {STATUS_META[event.status].label}
                      </span>
                      {event.operator === 'manual' && <span className="badge badge-warning">人工操作</span>}
                      {event.sourceSide && (
                        <span className="badge badge-info">
                          {event.sourceSide === 'source' ? '源目录' : event.sourceSide === 'target' ? '目标目录' : '双向'}
                        </span>
                      )}
                      <span className="event-time">{formatTime(event.timestamp)}</span>
                    </div>
                    {event.filePath && (
                      <div className="event-file-path">📁 {event.filePath}</div>
                    )}
                    {event.result && <div className="event-result">{event.result}</div>}
                    {event.syncDirection && (
                      <div className="event-direction">
                        方向: {event.syncDirection === 'source-to-target' ? '源 → 目标' : event.syncDirection === 'target-to-source' ? '目标 → 源' : '无'}
                      </div>
                    )}
                    {event.conflictResolution && (
                      <div className="event-resolution">
                        解决方式: {event.conflictResolution === 'source' ? '保留源版本' : event.conflictResolution === 'target' ? '保留目标版本' : '手动合并'}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedEvent && (
        <div className="event-detail-modal" onClick={() => setSelectedEvent(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>事件详情</h3>
              <button className="btn btn-icon" onClick={() => setSelectedEvent(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <table className="detail-table">
                <tbody>
                  <tr>
                    <td className="detail-label">事件ID</td>
                    <td className="detail-value mono">{selectedEvent.id}</td>
                  </tr>
                  <tr>
                    <td className="detail-label">类型</td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          backgroundColor: EVENT_TYPE_META[selectedEvent.type].color,
                          color: '#fff',
                        }}
                      >
                        {EVENT_TYPE_META[selectedEvent.type].icon} {EVENT_TYPE_META[selectedEvent.type].label}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="detail-label">时间</td>
                    <td className="detail-value">{formatTime(selectedEvent.timestamp)}</td>
                  </tr>
                  {selectedEvent.filePath && (
                    <tr>
                      <td className="detail-label">文件路径</td>
                      <td className="detail-value mono">{selectedEvent.filePath}</td>
                    </tr>
                  )}
                  <tr>
                    <td className="detail-label">状态</td>
                    <td>
                      <span className={`badge ${STATUS_META[selectedEvent.status].class}`}>
                        {STATUS_META[selectedEvent.status].label}
                      </span>
                    </td>
                  </tr>
                  {selectedEvent.sourceSide && (
                    <tr>
                      <td className="detail-label">来源端</td>
                      <td>{selectedEvent.sourceSide === 'source' ? '源目录' : selectedEvent.sourceSide === 'target' ? '目标目录' : '双向'}</td>
                    </tr>
                  )}
                  {selectedEvent.syncDirection && (
                    <tr>
                      <td className="detail-label">同步方向</td>
                      <td>
                        {selectedEvent.syncDirection === 'source-to-target'
                          ? '源目录 → 目标目录'
                          : selectedEvent.syncDirection === 'target-to-source'
                            ? '目标目录 → 源目录'
                            : '无'}
                      </td>
                    </tr>
                  )}
                  {selectedEvent.conflictResolution && (
                    <tr>
                      <td className="detail-label">冲突解决</td>
                      <td>
                        {selectedEvent.conflictResolution === 'source'
                          ? '保留源版本'
                          : selectedEvent.conflictResolution === 'target'
                            ? '保留目标版本'
                            : '手动合并'}
                      </td>
                    </tr>
                  )}
                  {selectedEvent.fileHash && (
                    <tr>
                      <td className="detail-label">文件哈希</td>
                      <td className="detail-value mono">{selectedEvent.fileHash}</td>
                    </tr>
                  )}
                  {selectedEvent.previousHash && (
                    <tr>
                      <td className="detail-label">旧哈希</td>
                      <td className="detail-value mono">{selectedEvent.previousHash}</td>
                    </tr>
                  )}
                  {selectedEvent.fileSize !== undefined && (
                    <tr>
                      <td className="detail-label">文件大小</td>
                      <td>{selectedEvent.fileSize.toLocaleString()} B</td>
                    </tr>
                  )}
                  {selectedEvent.operator && (
                    <tr>
                      <td className="detail-label">操作人</td>
                      <td>{selectedEvent.operator === 'system' ? '系统自动' : '人工手动'}</td>
                    </tr>
                  )}
                  {selectedEvent.result && (
                    <tr>
                      <td className="detail-label">处理结果</td>
                      <td>{selectedEvent.result}</td>
                    </tr>
                  )}
                  {selectedEvent.details && Object.keys(selectedEvent.details).length > 0 && (
                    <tr>
                      <td className="detail-label">附加信息</td>
                      <td className="detail-value mono">
                        <pre>{JSON.stringify(selectedEvent.details, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
