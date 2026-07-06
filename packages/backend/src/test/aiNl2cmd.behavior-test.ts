import assert from 'node:assert/strict';
import {
  cleanCommandOutput,
  detectDangerousCommand,
  readProviderText,
  sanitizeUserInput,
} from '../ai-ops/nl2cmd.helpers';
import {
  applySavedAISettingsPatch,
  maskAISettingsForClient,
} from '../ai-ops/ai-settings.helpers';

assert.equal(
  sanitizeUserInput('  ```\n列出${PWD}\u200B下面的大文件\n```  '),
  '列出PWD下面的大文件',
  'user prompt should remove markdown fences, zero-width chars and shell interpolation markers',
);

assert.equal(
  cleanCommandOutput('```json\n{"command":"find . -type f -size +100M"}\n```'),
  'find . -type f -size +100M',
  'AI JSON response should be parsed into the command field',
);

assert.equal(
  cleanCommandOutput('{"cmd":"ls -la","explanation":"列出当前目录"}'),
  'ls -la',
  'AI JSON response should accept common command aliases from compatible providers',
);

assert.equal(
  cleanCommandOutput('可以使用下面的命令：\n```bash\nls -la\n```'),
  'ls -la',
  'AI response with prose before a fenced command should extract the fenced command',
);

assert.equal(
  cleanCommandOutput(readProviderText([{ type: 'text', text: '{"command":"pwd"}' }])),
  'pwd',
  'OpenAI-compatible content arrays should be flattened before command cleanup',
);

assert.equal(
  cleanCommandOutput(readProviderText({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                arguments: '{"command":"df -h"}',
              },
            },
          ],
        },
      },
    ],
  })),
  'df -h',
  'OpenAI-compatible tool call arguments should be flattened before command cleanup',
);

assert.equal(
  cleanCommandOutput(readProviderText({
    output_text: '{"command":"uptime"}',
  })),
  'uptime',
  'Responses API output_text should be flattened before command cleanup',
);

assert.equal(
  cleanCommandOutput('<!doctype html><html lang="zh-CN"><head><title>One API</title></head><body><div id="root"></div></body></html>'),
  '',
  'HTML provider pages should never be treated as terminal commands',
);

assert.match(
  detectDangerousCommand('rm -rf /') || '',
  /根目录|删除/,
  'dangerous destructive commands should return a warning',
);

const savedSettings = applySavedAISettingsPatch(
  {
    enabled: true,
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-old-secret',
    model: 'gpt-5-nano',
    openaiEndpoint: '/chat/completions',
  },
  {
    enabled: true,
    provider: 'openai',
    baseUrl: 'https://compatible.example/v1',
    apiKey: 'sk-old...',
    model: 'gpt-5-nano',
    openaiEndpoint: '/responses',
  },
);

assert.equal(
  savedSettings.apiKey,
  'sk-old-secret',
  'saving a masked key should preserve the previously stored API key',
);

assert.equal(
  maskAISettingsForClient({ ...savedSettings, apiKey: '1234567890abcdef' }).apiKey,
  '12345678...',
  'client-facing AI settings should never expose the full API key',
);

console.log('AI NL2CMD behavior ok');
