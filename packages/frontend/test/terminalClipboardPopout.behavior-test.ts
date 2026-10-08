import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

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

// Execute the component handlers so bypassing xterm's paste protocol is caught.
const readHandler = (name: string, nextName: string): string => {
  const start = terminalSource.indexOf(`const ${name} =`);
  const end = terminalSource.indexOf(`const ${nextName} =`, start);
  assert.ok(start >= 0 && end > start, `missing clipboard handler ${name}`);
  return ts.transpileModule(terminalSource.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
};

for (const [handler, nextHandler] of [
  ['handleContextMenuPaste', 'addContextMenuListener'],
  ['terminalClipboardKeyDownHandler', 'addTerminalClipboardKeydownListener'],
]) {
  for (const text of ['sudo sh /tmp/install-hub.sh \\\r\n  --yes\r\n\r\n', '中文选项', '']) {
    const pasted: string[] = [];
    const sent: string[] = [];
    const context = vm.createContext({
      readTerminalClipboard: () => ({ readText: async () => text }),
      terminal: { paste: (value: string) => pasted.push(value) },
      emitTerminalInput: (value: string) => sent.push(value),
      console,
      event: {
        ctrlKey: true, shiftKey: true, altKey: false, code: 'KeyV',
        preventDefault() {}, stopPropagation() {},
      },
    });
    await vm.runInContext(`${readHandler(handler, nextHandler)}\n${handler}(event)`, context);
    assert.deepEqual(sent, [], `${handler} must not send clipboard newlines directly to the remote shell`);
    assert.deepEqual(pasted, text ? [text] : [], `${handler} should delegate unchanged clipboard text to xterm exactly once`);
  }
}

console.log('terminal clipboard popout behavior ok');
