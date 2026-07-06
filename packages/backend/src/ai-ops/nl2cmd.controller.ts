import { Request, Response } from 'express';
import * as NL2CMDService from './nl2cmd.service';
import { aiMessage, translateAIError } from './nl2cmd.service';
import type { AISettings, NL2CMDRequest } from './nl2cmd.types';

export async function getAISettings(req: Request, res: Response): Promise<void> {
  try {
    res.json({ success: true, settings: await NL2CMDService.getMaskedAISettings() });
  } catch (error) {
    console.error('[AI] 获取配置失败:', error);
    res.status(500).json({ success: false, message: aiMessage('settingsFetchFailed') });
  }
}

export async function saveAISettings(req: Request, res: Response): Promise<void> {
  try {
    const saved = await NL2CMDService.saveAISettings(req.body as Partial<AISettings>);
    res.json({ success: true, settings: saved, message: aiMessage('settingsSaved') });
  } catch (error) {
    const message = translateAIError(error, 'settingsSaveFailed');
    res.status(400).json({ success: false, message });
  }
}

export async function generateCommand(req: Request, res: Response): Promise<void> {
  const body = req.body as NL2CMDRequest;
  if (!body || typeof body.query !== 'string' || !body.query.trim()) {
    res.status(400).json({ success: false, error: aiMessage('queryRequired') });
    return;
  }

  if (body.query.length > 500) {
    res.status(400).json({ success: false, error: aiMessage('queryTooLong') });
    return;
  }

  const result = await NL2CMDService.generateCommand(body);
  res.status(result.success ? 200 : 400).json(result);
}

export async function testAIConnection(req: Request, res: Response): Promise<void> {
  try {
    const settings = req.body as AISettings;
    const currentSettings = await NL2CMDService.getAISettings();
    const apiKey = settings.apiKey?.includes('...') ? currentSettings.apiKey : settings.apiKey;
    const success = await NL2CMDService.testAIConnection({ ...settings, apiKey });
    res.json({ success, message: success ? aiMessage('testSuccess') : aiMessage('testFailed') });
  } catch (error) {
    const message = translateAIError(error, 'testFailed');
    res.status(400).json({ success: false, error: message });
  }
}
