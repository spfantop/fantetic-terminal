import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTerminalBackgroundDocument } from '../src/features/appearance/terminal-background-document';

const hostileHtml = '<style>.pulse { animation: pulse 1s infinite; }</style><div class="pulse">ok</div><script>parent.document.body.dataset.compromised = "true"</script>';
const documentHtml = buildTerminalBackgroundDocument(hostileHtml);

assert.match(documentHtml, /Content-Security-Policy/);
assert.match(documentHtml, /script-src 'unsafe-inline'/);
assert.match(documentHtml, /connect-src 'none'/);
assert.match(documentHtml, /form-action 'none'/);
assert.match(documentHtml, /img-src data: blob:/);
assert.match(documentHtml, /<style>\.pulse/);
assert.match(documentHtml, /<div class="pulse">ok<\/div>/);

const layoutRendererSource = readFileSync(resolve('src/components/LayoutRenderer.vue'), 'utf8');
assert.match(layoutRendererSource, /<iframe[\s\S]*sandbox="allow-scripts"[\s\S]*:srcdoc="terminalBackgroundDocument"/);
assert.doesNotMatch(layoutRendererSource, /allow-same-origin/);
assert.doesNotMatch(layoutRendererSource, /v-html="terminalCustomHTML"/);
assert.doesNotMatch(layoutRendererSource, /executeScriptsInElement/);

console.log('terminal background document behavior ok');
