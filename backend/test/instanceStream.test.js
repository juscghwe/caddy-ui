import { describe, expect, it, vi } from 'vitest';
const instances = [{ id: 'alpha' }, { id: 'beta' }].map(instance => ({ ...instance, name: instance.id, adminUrl: 'http://localhost:2019', configPath: '/data/Caddyfile', logPath: '/data/logs/access.log', dataPath: '/data/caddy', containerName: null, serverName: 'srv0' }));
vi.mock('../src/instances.js', () => ({ DEFAULT_INSTANCE_ID: 'default', getInstances: () => instances, getInstance: id => instances.find(item => item.id === id) || instances[0] }));
import { instanceMiddleware } from '../src/middleware/instance.js';
function select(query, path = '/logs/stream') {
    const req = { method: 'GET', path, query, headers: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn(); instanceMiddleware(req, res, next);
    return { req, res, next };
}
describe('cookie-authenticated stream instance selection', () => {
    it('selects the saved instance without custom EventSource headers or a destination URL', () => {
        const { req, next } = select({ instanceId: 'beta' });
        expect(req.instance.id).toBe('beta'); expect(next).toHaveBeenCalledOnce();
    });
    it('rejects unknown or ambiguous stream IDs rather than streaming another instance', () => {
        expect(select({ instanceId: 'missing' }).res.status).toHaveBeenCalledWith(404);
        expect(select({ instanceId: ['alpha', 'beta'] }).res.status).toHaveBeenCalledWith(400);
    });
    it('preserves default/header selection outside this specific stream protocol', () => {
        expect(select({}, '/logs/stream').req.instance.id).toBe('alpha');
        expect(select({ instanceId: 'beta' }, '/status').req.instance.id).toBe('alpha');
    });
});
