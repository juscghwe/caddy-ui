import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { docker } from '../dev-caddy/harness.mjs';
const execute = promisify(execFile);
const generator = new URL('../../frontend/docker-entrypoint.d/25-auth-proxy.sh', import.meta.url).pathname;
function get(port, headers) {
    return new Promise((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path: '/api/check', headers }, response => {
            let value = ''; response.setEncoding('utf8'); response.on('data', part => { value += part; });
            response.on('end', () => resolve(JSON.parse(value)));
        }); req.on('error', reject); req.end();
    });
}

test('frontend proxy rejects broad trust declarations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-ui-proxy-validation-'));
    try {
        for (const peer of ['0.0.0.0/0', '0.0.0.0/00', '192.168.1.1/0', '::/0', '::/000', 'example.com', '127.0.0.1;']) {
            await assert.rejects(execute('sh', [generator, join(directory, 'nginx.conf')], { env: { ...process.env, CADDY_UI_TRUSTED_EDGE_IPS: peer } }));
        }
    } finally { await rm(directory, { recursive: true, force: true }); }
});
test('real nginx preserves external Host and forwards HTTPS only from declared peers', { timeout: 90_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'caddy-ui-proxy-'));
    const network = 'caddy-ui-auth-proxy-' + randomBytes(8).toString('hex');
    const containers = [];
    const backend = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(req.headers)); }).listen(0, '0.0.0.0');
    await once(backend, 'listening');
    let created = false;
    try {
        await docker(['network', 'create', network]); created = true;
        const [detail] = JSON.parse(await docker(['network', 'inspect', network]));
        const gateway = detail.IPAM.Config[0].Gateway;
        const upstream = backend.address().port;
        const source = await readFile(new URL('../../frontend/nginx.conf', import.meta.url), 'utf8');
        for (const trusted of [false, true]) {
            const map = join(directory, trusted ? 'trusted.conf' : 'untrusted.conf');
            await execute('sh', [generator, map], { env: { ...process.env, CADDY_UI_TRUSTED_EDGE_IPS: trusted ? gateway + '/32' : '' } });
            const config = join(directory, trusted ? 'trusted-default.conf' : 'untrusted-default.conf');
            await writeFile(config, source.replace('http://caddy-ui-backend:3001', `http://host.docker.internal:${upstream}`));
            const name = network + (trusted ? '-trusted' : '-untrusted'); containers.push(name);
            await docker(['run', '--detach', '--name', name, '--network', network, '--add-host', 'host.docker.internal:host-gateway', '--publish', '127.0.0.1::80', '--mount', `type=bind,source=${map},target=/etc/nginx/conf.d/00-auth-proxy.conf,readonly`, '--mount', `type=bind,source=${config},target=/etc/nginx/conf.d/default.conf,readonly`, 'nginx:alpine']);
            const [container] = JSON.parse(await docker(['inspect', name]));
            const port = Number(container.NetworkSettings.Ports['80/tcp'][0].HostPort);
            const headers = { Host: 'ui.example.test:9877', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '198.51.100.1' };
            let forwarded;
            for (let attempt = 0; attempt < 30; attempt++) {
                try { forwarded = await get(port, headers); break; }
                catch { await new Promise(resolve => setTimeout(resolve, 100)); }
            }
            assert(forwarded, 'Nginx did not become ready');
            assert.equal(forwarded.host, headers.Host);
            assert.equal(forwarded['x-forwarded-proto'], trusted ? 'https' : 'http');
            assert.equal(forwarded['x-forwarded-for'], trusted ? headers['X-Forwarded-For'] : gateway);
            assert.equal((await get(port, { ...headers, 'X-Forwarded-Proto': 'https,http' }))['x-forwarded-proto'], 'http');
        }
    } finally {
        for (const name of containers) await docker(['rm', '-f', name]);
        if (created) await docker(['network', 'rm', network]);
        await new Promise(resolve => backend.close(resolve));
        await rm(directory, { recursive: true, force: true });
    }
});
test('optional HTTPS Compose validates with explicit host and separate auth key volume', async () => {
    const { stdout } = await execute('docker', ['compose', '-f', 'deploy/bootstrap.compose.yml', 'config', '--format', 'json'], { cwd: new URL('../../', import.meta.url), env: { ...process.env, CADDY_UI_HOST: 'ui.example.test' } });
    const config = JSON.parse(stdout);
    const backend = config.services['caddy-ui-backend'];
    assert.equal(backend.environment.CADDY_UI_AUTH_MODE, 'required');
    assert.equal(backend.environment.CADDY_UI_EXTERNAL_URL, 'https://ui.example.test:9877');
    assert(backend.volumes.some(volume => volume.target === '/etc/caddy-ui-keys'));
    assert(backend.ports.every(port => Number(port.target) !== 3001));
    assert.equal(backend.ports[0].host_ip, '127.0.0.1');
});
