import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const entrypoint = fs.readFileSync(path.resolve(process.cwd(), 'entrypoint.sh'), 'utf8');

assert.doesNotMatch(entrypoint, /wait -n[^\n]*\|\| true/);
assert.match(entrypoint, /wait -n -p EXITED_PID/);
assert.match(entrypoint, /CHILD_EXIT_CODE=\$\?/);
assert.match(entrypoint, /shutdown "\$CHILD_EXIT_CODE"/);
assert.match(entrypoint, /trap 'shutdown 0' SIGTERM SIGINT SIGQUIT/);
assert.match(entrypoint, /exit "\$exit_code"/);

console.log('remote-gateway process lifecycle behavior ok');
