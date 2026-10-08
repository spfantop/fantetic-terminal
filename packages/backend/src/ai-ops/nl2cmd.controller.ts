import { sendApiError } from '../security/api-error-envelope';
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
    sendApiError(res, 400, 'ai.queryRequired');
    return;
  }

  if (body.query.length > 500) {
    sendApiError(res, 400, 'ai.queryTooLong');
    return;
  }

  const result = await NL2CMDService.generateCommand(body);
  if (!result.success) {
    sendApiError(res, 400, result.errorCode || 'ai.generateFailed');
    return;
  }
  res.json(result);
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
