import { DEFAULT_INSTANCE_ID, getInstance, getInstances } from '../instances.js';
import { validateContainerName, validatePath, validateServerName, validateUrl } from '../validation.js';

export function instanceMiddleware(req, res, next) {
    if (getInstances().length === 0) {
        return res.status(503).json({ error: 'No instances configured', code: 'NO_INSTANCES' });
    }

    const instanceId = req.headers['x-instance-id'] || DEFAULT_INSTANCE_ID;
    // Native EventSource cannot send the selected-instance header. A non-secret
    // registry ID selects only this stream; it never supplies a destination URL.
    const streamSelection = req.method === 'GET' && req.path === '/logs/stream' && Object.hasOwn(req.query, 'instanceId');
    const instance = streamSelection ? getInstances().find(item => item.id === req.query.instanceId) : getInstance(instanceId);
    if (streamSelection && typeof req.query.instanceId !== 'string') {
        return res.status(400).json({ error: 'Invalid stream instance', code: 'VALIDATION_FAILED' });
    }
    if (!instance) return res.status(404).json({ error: 'Instance not found', code: 'INSTANCE_NOT_FOUND' });

    try {
        req.instance = {
            id: instance.id,
            name: instance.name,
            adminUrl: validateUrl(instance.adminUrl),
            configPath: validatePath(instance.configPath),
            logPath: validatePath(instance.logPath),
            dataPath: validatePath(instance.dataPath),
            containerName: validateContainerName(instance.containerName),
            serverName: validateServerName(instance.serverName),
        };
    } catch {
        return res.status(400).json({ error: 'Invalid instance configuration' });
    }

    next();
}
