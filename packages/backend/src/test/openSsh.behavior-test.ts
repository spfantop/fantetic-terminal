import assert from 'node:assert/strict';
import { buildOpenSshArguments } from '../services/openssh.service';
const target = { host: 'example.test', port: 22, username: 'operator', auth_method: 'password' as const };
const args = buildOpenSshArguments(target);
assert.equal(args.includes('ConnectTimeout=30'), process.platform !== 'win32');
assert.deepEqual(buildOpenSshArguments({ ...target, connection_proxy_setting: 'proxy', proxy: null }), args);
assert.throws(() => buildOpenSshArguments({ ...target, proxy: { id: 1, name: 'proxy', host: 'example.test', port: 1080, type: 'SOCKS5' } }));
assert.equal(args.at(-1), 'example.test');
assert.ok(args.includes('StrictHostKeyChecking=ask'));
for (const host of ['-oProxyCommand=evil', 'a b', 'x\nfoo']) {
  assert.throws(() => buildOpenSshArguments({ ...target, host }));
}
assert.throws(() => buildOpenSshArguments({ ...target, port: -1 }));
assert.throws(() => buildOpenSshArguments({ ...target, auth_method: 'key' }));
console.info('OpenSSH arguments: PASS');
