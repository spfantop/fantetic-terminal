import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const terminalSource = fs.readFileSync(path.resolve('src/components/Terminal.vue'), 'utf8');

assert.match(
  terminalSource,
  /const readTerminalDocument = \(\) => terminalRef\.value\?\.ownerDocument \?\? document/,
  'terminal clipboard handlers should resolve the active document from the terminal DOM',
);

assert.match(
  terminalSource,
  /const readTerminalWindow = \(\) => readTerminalDocument\(\)\.defaultView \?\? window/,
  'terminal clipboard handlers should resolve the active window from the terminal document',
);

assert.match(
  terminalSource,
  /const readTerminalClipboard = \(\) => readTerminalWindow\(\)\.navigator\.clipboard/,
  'terminal clipboard handlers should use the active window clipboard instead of the opener clipboard',
);

assert.match(
  terminalSource,
  /await readTerminalClipboard\(\)\?\.readText\(\)/,
  'right-click and keyboard paste should read from the active terminal clipboard',
);

assert.match(
  terminalSource,
  /readTerminalClipboard\(\)\?\.writeText\(selection\)/,
  'keyboard copy should write to the active terminal clipboard',
);

assert.match(
  terminalSource,
  /const clipboard = readTerminalClipboard\(\);[\s\S]*clipboard\.writeText\(newSelection\)/,
  'selection auto-copy should write to the active terminal clipboard',
);

assert.match(
  terminalSource,
  /const terminalClipboardKeyDownHandler = async \(event: KeyboardEvent\)/,
  'terminal clipboard shortcut handler should be a named function so it can be rebound and removed safely',
);

assert.match(
  terminalSource,
  /addTerminalClipboardKeydownListener[\s\S]*terminal\.textarea\.addEventListener\('keydown', terminalClipboardKeyDownHandler, \{ capture: true \}\)/,
  'terminal clipboard shortcuts should bind in capture phase on the xterm textarea',
);

assert.match(
  terminalSource,
  /terminalRef\.value\.addEventListener\('contextmenu', handleContextMenuPaste, \{ capture: true \}\)/,
  'terminal right-click paste should bind in capture phase on the current terminal container',
);

assert.match(
  terminalSource,
  /removeTerminalClipboardKeydownListener\(\)/,
  'terminal clipboard shortcut listener should be removed on unmount',
);

console.log('terminal clipboard popout behavior ok');
