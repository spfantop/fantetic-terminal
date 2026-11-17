import type { SshAuthChallenge } from '@fantetic-terminal/contracts';

export const readSshAuthChallenge = (value: unknown): SshAuthChallenge | null => {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (typeof data.requestId !== 'string' || data.requestId.length > 128
    || typeof data.name !== 'string' || data.name.length > 4096
    || typeof data.username !== 'string' || data.username.length > 4096
    || typeof data.instructions !== 'string' || data.instructions.length > 8192
    || !Array.isArray(data.prompts) || data.prompts.length < 1 || data.prompts.length > 8) return null;
  const prompts: SshAuthChallenge['prompts'] = [];
  for (const item of data.prompts) {
    if (!item || typeof item !== 'object' || typeof item.prompt !== 'string'
      || item.prompt.length > 4096 || typeof item.echo !== 'boolean') return null;
    prompts.push({ prompt: item.prompt, echo: item.echo });
  }
  return { requestId: data.requestId, name: data.name, username: data.username, instructions: data.instructions, prompts };
};
