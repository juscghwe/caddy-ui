import { pathToFileURL } from 'node:url';
import { authConfig } from './config.js';
import { setupCertificate } from './setupServer.js';
import * as maintenance from './maintenance.js';

const help = `Local caddy/ui authentication maintenance (Node 24, deployment owner only).
Stop the backend first. Commands require --offline-confirmed.

  import-legacy                    Import complete legacy environment values
  setup-code                       Replace the unclaimed installation's setup code
  reset-password USERNAME          Read a new password from hidden stdin; enable account
  recovery-code                    Replace the recovery bundle; export NEW code once
  recover-key                      Read recovery export/code from stdin; restore missing key
  backup DIRECTORY                 Create a new encrypted auth backup directory
  restore DIRECTORY                Read recovery export/code from stdin; replace auth state
  rotate-key                       Rotate database key; export NEW recovery code once
  complete-transition              Resume an interrupted prepared restore/key rotation
  cancel-transition                Discard staging only if the active database is readable
  certificate                      Export app CA PEM and its DER SHA-256 fingerprint

Passwords/recovery codes must never appear in command arguments. Noninteractive
stdin accepts one password/code or a downloaded recovery JSON export (up to 16 KiB).
Recovery exports printed by local commands must be saved directly in a vault.
`;

export async function readSecret(input = process.stdin, output = process.stderr) {
    if (!input.isTTY) {
        const chunks = []; let size = 0;
        for await (const chunk of input) {
            size += Buffer.byteLength(chunk);
            if (size > 16 * 1024) throw new Error('Secret input is too large');
            chunks.push(chunk);
        }
        return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8').replace(/\r?\n$/, '');
    }
    input.setEncoding('utf8');
    output.write('Secret (input hidden): ');
    return new Promise((resolve, reject) => {
        let value = '';
        const finish = error => {
            input.off('data', receive); input.setRawMode(false); input.pause(); output.write('\n');
            if (error) reject(error); else resolve(value);
        };
        const receive = bytes => {
            for (const character of bytes.toString('utf8')) {
                if (character === '\u0003' || character === '\u0004') return finish(new Error('Cancelled'));
                if (character === '\r' || character === '\n') return finish();
                if (character === '\u007f' || character === '\b') value = Array.from(value).slice(0, -1).join('');
                else if (character >= ' ') value += character;
                if (Buffer.byteLength(value) > 16 * 1024) return finish(new Error('Secret input is too large'));
            }
        };
        input.setRawMode(true); input.resume(); input.on('data', receive);
    });
}
function recoveryInput(secret) {
    try {
        const value = secret.trim().startsWith('{') ? JSON.parse(secret) : { recoveryCode: secret };
        if (typeof value.recoveryCode !== 'string') throw new Error();
        return value;
    } catch { throw new Error('Invalid recovery input'); }
}
export async function run(args, { env = process.env, input = process.stdin, output = process.stdout } = {}) {
    if (!args.length || args[0] === '--help') { output.write(help); return; }
    const offline = args.includes('--offline-confirmed');
    const [command, ...parameters] = args.filter(value => value !== '--offline-confirmed');
    const commands = ['import-legacy', 'setup-code', 'reset-password', 'recovery-code', 'recover-key', 'backup', 'restore', 'rotate-key', 'complete-transition', 'cancel-transition', 'certificate'];
    if (!commands.includes(command)) throw new Error('Unknown command; use --help');
    if (parameters.length !== (['reset-password', 'backup', 'restore'].includes(command) ? 1 : 0)) throw new Error('Unexpected arguments; secrets must use stdin');
    if (!offline) throw new Error('Stop the backend and add --offline-confirmed before local maintenance');
    const config = authConfig(env, { migration: command === 'import-legacy' });
    if (config.mode !== 'required') throw new Error('Local maintenance requires CADDY_UI_AUTH_MODE=required');
    if (command === 'import-legacy') {
        await maintenance.importLegacy(config, env);
        output.write('Legacy administrator imported. Remove CADDY_UI_USER, CADDY_UI_PASSWORD and JWT_SECRET; restart and complete the one-time HTTPS exchange.\n');
    } else if (command === 'setup-code') output.write(await maintenance.setupCode(config) + '\n');
    else if (command === 'reset-password') {
        await maintenance.resetPassword(config, parameters[0], await readSecret(input));
        output.write('Administrator password replaced and account enabled. All browser sessions revoked.\n');
    } else if (command === 'recovery-code' || command === 'rotate-key') {
        const result = command === 'recovery-code' ? await maintenance.regenerateRecovery(config) : await maintenance.rotateKey(config);
        output.write(JSON.stringify(result, null, 2) + '\n');
    } else if (command === 'recover-key' || command === 'restore') {
        const recovery = recoveryInput(await readSecret(input));
        if (command === 'restore') await maintenance.restore(config, parameters[0], recovery);
        else await maintenance.recoverKey(config, recovery);
        output.write('Auth state recovered. All browser sessions and setup challenges revoked.\n');
    } else if (command === 'backup') {
        await maintenance.backup(config, parameters[0]); output.write('Encrypted auth backup created. Preserve the separate recovery code and TLS state.\n');
    } else if (command === 'complete-transition' || command === 'cancel-transition') {
        await maintenance[command === 'complete-transition' ? 'completeTransition' : 'cancelTransition'](config);
        output.write('Local transition handled.\n');
    } else {
        const certificate = await setupCertificate(config);
        output.write('App CA SHA-256 fingerprint (DER): ' + certificate.fingerprint + '\n' + certificate.pem);
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { await run(process.argv.slice(2)); }
    catch {
        // Crypto/JSON/SQLite errors can contain supplied secrets. Never echo causes.
        process.stderr.write('Auth maintenance failed. Check command/configuration, stop the backend, verify protected input/state, and inspect pending transitions locally. Use --help for usage.\n');
        process.exitCode = 1;
    }
}
