"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const EventLogManager_1 = require("../modules/EventLogManager");
const router = express_1.default.Router();
function parseNumber(q, defaultValue) {
    if (q === undefined || q === null || q === '')
        return defaultValue;
    const n = parseInt(String(q), 10);
    return isNaN(n) ? defaultValue : n;
}
function parseArray(q) {
    if (q === undefined || q === null || q === '')
        return undefined;
    if (Array.isArray(q))
        return q;
    if (typeof q === 'string')
        return q.split(',').map((s) => s.trim());
    return undefined;
}
router.get('/', async (req, res) => {
    try {
        const params = {
            startTime: parseNumber(req.query.startTime),
            endTime: parseNumber(req.query.endTime),
            filePath: req.query.filePath ? String(req.query.filePath) : undefined,
            eventTypes: parseArray(req.query.eventTypes),
            status: req.query.status ? req.query.status : undefined,
            sourceSide: req.query.sourceSide
                ? req.query.sourceSide
                : undefined,
            limit: parseNumber(req.query.limit, 1000),
            offset: parseNumber(req.query.offset, 0),
            aggregate: req.query.aggregate === 'hourly' ||
                req.query.aggregate === 'daily' ||
                req.query.aggregate === 'count' ||
                req.query.aggregate === 'none'
                ? req.query.aggregate
                : 'none',
            sample: parseNumber(req.query.sample),
        };
        const result = await EventLogManager_1.eventLogManager.query(params);
        res.json(result);
    }
    catch (error) {
        console.error('[Events Route] Query error:', error);
        res.status(500).json({ error: error.message });
    }
});
router.get('/time-range', async (req, res) => {
    try {
        const range = await EventLogManager_1.eventLogManager.getTimeRange();
        res.json(range);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.get('/stats', async (req, res) => {
    try {
        const stats = await EventLogManager_1.eventLogManager.getStats();
        res.json(stats);
    }
    catch (error) {
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
exports.default = router;
//# sourceMappingURL=events.js.map