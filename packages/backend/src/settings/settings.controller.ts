import { Request, Response } from 'express';
import { settingsService } from './settings.service';
import { AuditLogService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service'; 
import { ipBlacklistService } from '../auth/ip-blacklist.service';
import { exportConnectionsAsEncryptedZip, importConnectionsFromEncryptedZip } from '../services/import-export.service'; 
import { UpdateSidebarConfigDto, UpdateCaptchaSettingsDto, CaptchaSettings } from '../types/settings.types'; 
import { AppearanceSettings, UpdateAppearanceDto } from '../types/appearance.types';
import { getAppearanceSettings, updateAppearanceSettings as updateAppearanceSettingsInRepo } from '../appearance/appearance.repository';
import i18next from '../i18n'; 
import { statusMonitorService } from '../websocket/state';

const auditLogService = new AuditLogService();
const notificationService = new NotificationService(); 

export const settingsController = {
/**
   * 获取外观设置
   */
  async getAppearanceSettings(req: Request, res: Response): Promise<void> {
    try {
      const settings = await getAppearanceSettings(req.authorization!.userId);
      res.json(settings);
    } catch (error: any) {
      console.error('获取外观设置时出错:', error);
      res.status(500).json({ message: '获取外观设置失败', error: error.message });
    }
  },
/**
   * 更新外观设置
   */
  async updateAppearanceSettings(req: Request, res: Response): Promise<void> {
    try {
      const settingsDto: UpdateAppearanceDto = req.body;
      // 可在此处添加 DTO 验证逻辑
      if (typeof settingsDto !== 'object' || settingsDto === null) {
        res.status(400).json({ message: '无效的请求体，应为 JSON 对象' });
        return;
      }

      const result = await updateAppearanceSettingsInRepo(settingsDto, req.authorization!.userId);
      if (result) {
        res.status(200).json({ message: '外观设置已成功更新' });
      } else {
        // 如果仓库层返回 false，可能表示没有实际更改或更新失败
        res.status(200).json({ message: '外观设置未发生更改或更新失败' });
      }
    } catch (error: any) {
      console.error('更新外观设置时出错:', error);
      res.status(500).json({ message: '更新外观设置失败', error: error.message });
    }
  },
  /**
   * 获取所有设置项
   */
  async getAllSettings(req: Request, res: Response): Promise<void> {
    try {
      const settings = await settingsService.getAllSettings(req.authorization!);
      res.json(settings);
    } catch (error: any) {
      console.error('获取所有设置时出错:', error);
      res.status(500).json({ message: '获取设置失败', error: error.message });
    }
  },

  /**
   * 批量更新设置项
   */
  async updateSettings(req: Request, res: Response): Promise<void> {
    try {
      const settingsToUpdate: Record<string, string> = req.body;
      if (typeof settingsToUpdate !== 'object' || settingsToUpdate === null) {
        res.status(400).json({ message: '无效的请求体，应为 JSON 对象' });
        return;
      }

      const allowedSettingsKeys = [
          'language', 'ipWhitelist', 'maxLoginAttempts', 'loginBanDuration',
          'showPopupFileEditor', 'shareFileEditorTabs', 'ipWhitelistEnabled',
          'autoCopyOnSelect', 'dockerManagerEnabled', 'dockerStatusIntervalSeconds', 'dockerDefaultExpand',
          'statusMonitorEnabled', 'statusMonitorIntervalSeconds', // +++ 状态监控设置键 +++
          'sessionRecordingEnabled', // 会话录像设置键
          'workspaceSidebarPersistent', // +++ 侧边栏固定键 +++
          'showPopupFileManager', // +++ 弹窗文件管理器设置键 +++
          'sidebarPaneWidths', // +++ 侧边栏宽度对象键 +++
          'fileManagerRowSizeMultiplier', // +++ 文件管理器行大小键 +++
          'fileManagerColWidths', // +++ 文件管理器列宽键 +++
          'commandInputSyncTarget', // +++ 命令输入同步目标键 +++
          'timezone', // 时区键
          'rdpModalWidth', //  RDP 模态框宽度键
          'rdpModalHeight', //  RDP 模态框高度键
          'vncModalWidth', //  VNC 模态框宽度键
          'vncModalHeight', //  VNC 模态框高度键
          'rdpDefaultFixedResolution',
          'rdpDefaultWidth',
          'rdpDefaultHeight',
          'rdpDefaultQuality',
          'vncDefaultFixedResolution',
          'vncDefaultWidth',
          'vncDefaultHeight',
          'vncDefaultQuality',
          'ipBlacklistEnabled', // <-- 添加 IP 黑名单启用键
          'layoutLocked', // +++ 布局锁定键 +++
          'terminalScrollbackLimit', // 终端回滚行数键
          'fileManagerShowDeleteConfirmation', // 文件管理器删除确认键
          'terminalEnableRightClickPaste', // 终端右键粘贴键
          'terminalPerformanceMode', // 终端性能模式
          'terminalHighlightEnabled', // 终端日志高亮开关
          'terminalHighlightRules', // 终端日志高亮规则
          'showStatusMonitorIpAddress' // 添加状态监视器IP显示键 (与服务层和前端统一)
      ];
      const filteredSettings: Record<string, string> = {};
      for (const key in settingsToUpdate) {
          if (allowedSettingsKeys.includes(key)) {
              filteredSettings[key] = settingsToUpdate[key];
          }
      }

      if (Object.keys(filteredSettings).length > 0) {
          await settingsService.setMultipleSettings(filteredSettings, req.authorization!);
          if (Object.prototype.hasOwnProperty.call(filteredSettings, 'statusMonitorEnabled')) {
              await statusMonitorService.syncPollingWithEnabledSetting();
          }
      } 

      const updatedKeys = Object.keys(filteredSettings);
      if (updatedKeys.length > 0) {
          if (updatedKeys.includes('ipWhitelist') || updatedKeys.includes('ipWhitelistEnabled')) {
              auditLogService.logAction('IP_WHITELIST_UPDATED', { updatedKeys });
          } else {
              auditLogService.logAction('SETTINGS_UPDATED', { updatedKeys });
              notificationService.sendNotification('SETTINGS_UPDATED', { updatedKeys }); // 添加通知调用
            }
        }
      res.status(200).json({ message: '设置已成功更新' });
    } catch (error: any) {
      console.error('更新设置时出错:', error);
      const forbidden = error.message?.includes('系统管理员权限');
      res.status(forbidden ? 403 : 500).json({ message: '更新设置失败', error: error.message });
    }
  },

  /**
   * 获取焦点切换顺序
   */
  async getFocusSwitcherSequence(req: Request, res: Response): Promise<void> {
    try {
      const sequence = await settingsService.getFocusSwitcherSequence(req.authorization!.userId);
      res.json(sequence);
    } catch (error: any) {
      console.error('[控制器] 获取焦点切换顺序时出错:', error);
      res.status(500).json({ message: '获取焦点切换顺序失败', error: error.message });
    }
  },

  /**
   * 设置焦点切换顺序
   */
  async setFocusSwitcherSequence(req: Request, res: Response): Promise<void> {
    try {
      // +++ 修改：获取请求体并验证其是否符合 FocusSwitcherFullConfig 结构 +++
      const fullConfig = req.body;
      console.log('[控制器] 请求体 fullConfig:', JSON.stringify(fullConfig));

      // +++ 验证 FocusSwitcherFullConfig 结构 +++
      if (
          !(typeof fullConfig === 'object' && fullConfig !== null &&
          Array.isArray(fullConfig.sequence) && fullConfig.sequence.every((item: any) => typeof item === 'string') &&
          typeof fullConfig.shortcuts === 'object' && fullConfig.shortcuts !== null &&
          Object.values(fullConfig.shortcuts).every((sc: any) => typeof sc === 'object' && sc !== null && (sc.shortcut === undefined || typeof sc.shortcut === 'string')))
      ) {
        console.warn('[控制器] 收到无效的完整焦点配置格式:', fullConfig);
        res.status(400).json({ message: '无效的请求体，必须是包含 sequence (string[]) 和 shortcuts (Record<string, {shortcut?: string}>) 的对象' });
        return;
      }

      
      // +++ 传递验证后的 fullConfig 给服务层 +++
      await settingsService.setFocusSwitcherSequence(fullConfig, req.authorization!.userId);
      

      
  
      
      res.status(200).json({ message: '焦点切换顺序已成功更新' });
    } catch (error: any) {
      console.error('[控制器] 设置焦点切换顺序时出错:', error);
      if (error.message === 'Invalid sequence format provided.') {
          res.status(400).json({ message: '设置焦点切换顺序失败: 无效的格式', error: error.message });
      } else {
          res.status(500).json({ message: '设置焦点切换顺序失败', error: error.message });
      }
    }
  },

 /**
  * 获取导航栏可见性设置
  */
 async getNavBarVisibility(req: Request, res: Response): Promise<void> {
   try {
     const isVisible = await settingsService.getNavBarVisibility(req.authorization!.userId);
     res.json({ visible: isVisible });
   } catch (error: any) {
     console.error('[控制器] 获取导航栏可见性时出错:', error);
     res.status(500).json({ message: '获取导航栏可见性失败', error: error.message });
   }
 },

 /**
  * 设置导航栏可见性
  */
 async setNavBarVisibility(req: Request, res: Response): Promise<void> {
   try {
     const { visible } = req.body;
     console.log('[控制器] 请求体 visible:', visible);

     if (typeof visible !== 'boolean') {
       console.warn('[控制器] 收到无效的 visible 格式:', visible);
       res.status(400).json({ message: '无效的请求体，"visible" 必须是一个布尔值' });
       return;
     }

     
     await settingsService.setNavBarVisibility(visible, req.authorization!.userId);
     


     
     res.status(200).json({ message: '导航栏可见性已成功更新' });
   } catch (error: any) {
     console.error('[控制器] 设置导航栏可见性时出错:', error);
     res.status(500).json({ message: '设置导航栏可见性失败', error: error.message });
   }
 },

  /**
   * 获取布局树设置
   */
  async getLayoutTree(req: Request, res: Response): Promise<void> {
    try {
      const layoutJson = await settingsService.getLayoutTree(req.authorization!.userId);
      if (layoutJson) {
        try {
          const layout = JSON.parse(layoutJson);
          
          res.json(layout);
        } catch (parseError) {
          console.error('[控制器] 从数据库解析布局树 JSON 失败:', parseError);
          res.status(500).json({ message: '获取布局树失败：存储的数据格式无效' });
        }
      } else {
        
        res.json(null);
      }
    } catch (error: any) {
      console.error('[控制器] 获取布局树时出错:', error);
      res.status(500).json({ message: '获取布局树失败', error: error.message });
    }
  },

  /**
   * 设置布局树
   */
  async setLayoutTree(req: Request, res: Response): Promise<void> {
    try {
      const layoutTree = req.body;

      if (typeof layoutTree !== 'object' || layoutTree === null) {
         console.warn('[控制器] 收到无效的布局树格式 (非对象):', layoutTree);
         res.status(400).json({ message: '无效的请求体，应为 JSON 对象格式的布局树' });
         return;
      }

      const layoutJson = JSON.stringify(layoutTree);

      
      await settingsService.setLayoutTree(layoutJson, req.authorization!.userId);
      

      // auditLogService.logAction('LAYOUT_TREE_UPDATED');

      
      res.status(200).json({ message: '布局树已成功更新' });
    } catch (error: any) {
      console.error('[控制器] 设置布局树时出错:', error);
       if (error.message === 'Invalid layout tree JSON format.') {
           res.status(400).json({ message: '设置布局树失败: 无效的 JSON 格式', error: error.message });
       } else {
           res.status(500).json({ message: '设置布局树失败', error: error.message });
       }
    }
  },

 /**
  * 获取 IP 黑名单列表 (分页)
   */
  async getIpBlacklist(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string || '50', 10);
      const offset = parseInt(req.query.offset as string || '0', 10);
      const result = await ipBlacklistService.getBlacklist(limit, offset);
      res.json(result);
    } catch (error: any) {
      console.error('获取 IP 黑名单时出错:', error);
      res.status(500).json({ message: '获取 IP 黑名单失败', error: error.message });
    }
  },

  /**
   * 从 IP 黑名单中删除一个 IP
   */
  async deleteIpFromBlacklist(req: Request, res: Response): Promise<void> {
    try {
      const ipToDelete = req.params.ip;
      if (!ipToDelete) {
        res.status(400).json({ message: '缺少要删除的 IP 地址' });
        return;
      }
      await ipBlacklistService.removeFromBlacklist(ipToDelete);
      res.status(200).json({ message: `IP 地址 ${ipToDelete} 已从黑名单中移除` });
    } catch (error: any) {
      console.error(`从 IP 黑名单删除 ${req.params.ip} 时出错:`, error);
      res.status(500).json({ message: '从 IP 黑名单删除失败', error: error.message });
    }
  }, // *** 确保这里有逗号 ***

  /**
   * 获取终端选中自动复制设置
   */
  async getAutoCopyOnSelect(req: Request, res: Response): Promise<void> {
    try {
      const isEnabled = await settingsService.getAutoCopyOnSelect(req.authorization!.userId);
      res.json({ enabled: isEnabled });
    } catch (error: any) {
      console.error('[控制器] 获取终端选中自动复制设置时出错:', error);
      res.status(500).json({ message: '获取终端选中自动复制设置失败', error: error.message });
    }
  }, // *** 确保这里有逗号 ***

  /**
   * 设置终端选中自动复制
   */
  async setAutoCopyOnSelect(req: Request, res: Response): Promise<void> {
    try {
      const { enabled } = req.body;
      console.log('[控制器] 请求体 enabled:', enabled);

      if (typeof enabled !== 'boolean') {
        console.warn('[控制器] 收到无效的 enabled 格式:', enabled);
        res.status(400).json({ message: '无效的请求体，"enabled" 必须是一个布尔值' });
        return;
      }

      
      await settingsService.setAutoCopyOnSelect(enabled, req.authorization!.userId);
      


      
      res.status(200).json({ message: '终端选中自动复制设置已成功更新' });
    } catch (error: any) {
      console.error('[控制器] 设置终端选中自动复制时出错:', error);
      res.status(500).json({ message: '设置终端选中自动复制失败', error: error.message });
    }
  },


 /**
  * 获取侧栏配置
  */
 async getSidebarConfig(req: Request, res: Response): Promise<void> {
     try {
         const config = await settingsService.getSidebarConfig(req.authorization!.userId);
         console.log('[控制器] 向客户端发送侧边栏配置:', config);
         res.json(config);
     } catch (error: any) {
         console.error('[控制器] 获取侧栏配置时出错:', error);
         res.status(500).json({ message: '获取侧栏配置失败', error: error.message });
     }
 },

 /**
  * 设置侧栏配置
  */
 async setSidebarConfig(req: Request, res: Response): Promise<void> {
     try {
         const configDto: UpdateSidebarConfigDto = req.body;
         console.log('[控制器] 请求体:', configDto);

         // --- DTO Validation (Basic) ---
         // More specific validation happens in the service layer
         if (!configDto || typeof configDto !== 'object' || !Array.isArray(configDto.left) || !Array.isArray(configDto.right)) {
             console.warn('[控制器] 收到无效的侧边栏配置格式:', configDto);
             res.status(400).json({ message: '无效的请求体，应为包含 left 和 right 数组的 JSON 对象' });
             return;
         }

         
         await settingsService.setSidebarConfig(configDto, req.authorization!.userId);
         


         
         res.status(200).json({ message: '侧栏配置已成功更新' });
     } catch (error: any) {
         console.error('[控制器] 设置侧栏配置时出错:', error);
         // Handle specific validation errors from the service
         if (error.message.includes('无效的面板名称') || error.message.includes('无效的侧栏配置格式')) {
              res.status(400).json({ message: `设置侧栏配置失败: ${error.message}` });
         } else {
              res.status(500).json({ message: '设置侧栏配置失败', error: error.message });
         }
     }
}, 

/**
 * 获取公共 CAPTCHA 配置 (不含密钥)
 */
async getCaptchaConfig(req: Request, res: Response): Promise<void> {
    try {
        const fullConfig = await settingsService.getCaptchaConfig();

        const publicConfig = {
            enabled: fullConfig.enabled,
            provider: fullConfig.provider,
            hcaptchaSiteKey: fullConfig.hcaptchaSiteKey,
            recaptchaSiteKey: fullConfig.recaptchaSiteKey,
        };

        console.log('[控制器] 向客户端发送公共 CAPTCHA 配置:', publicConfig);
        res.json(publicConfig);
    } catch (error: any) {
        console.error('[控制器] 获取 CAPTCHA 配置时出错:', error);
        res.status(500).json({ message: '获取 CAPTCHA 配置失败', error: error.message });
    }
},

/**
 * 设置 CAPTCHA 配置
 */
async setCaptchaConfig(req: Request, res: Response): Promise<void> {
    try {
        const configDto: UpdateCaptchaSettingsDto = req.body;
        console.log('[控制器] 请求体 (DTO, 密钥已屏蔽):', { ...configDto, hcaptchaSecretKey: '***', recaptchaSecretKey: '***' });

        if (!configDto || typeof configDto !== 'object') {
            console.warn('[控制器] 收到无效的 CAPTCHA 配置格式 (非对象):', configDto);
            res.status(400).json({ message: '无效的请求体，应为 JSON 对象' });
            return;
        }


        
        await settingsService.setCaptchaConfig(configDto);
        


        
        res.status(200).json({ message: 'CAPTCHA 配置已成功更新' });
    } catch (error: any) {
        console.error('[控制器] 设置 CAPTCHA 配置时出错:', error);
        // Handle specific validation errors from the service
        if (error.message.includes('无效的') || error.message.includes('必须是')) { 
             res.status(400).json({ message: `设置 CAPTCHA 配置失败: ${error.message}` });
        } else {
             res.status(500).json({ message: '设置 CAPTCHA 配置失败', error: error.message });
        }
    }
}, // <-- Add comma here

 // --- Show Connection Tags ---
 async getShowConnectionTags(req: Request, res: Response): Promise<void> {
   try {
     const isEnabled = await settingsService.getShowConnectionTags(req.authorization!.userId);
     res.json({ enabled: isEnabled });
   } catch (error: any) {
     console.error('[控制器] 获取“显示连接标签”设置时出错:', error);
     res.status(500).json({ message: '获取“显示连接标签”设置失败', error: error.message });
   }
 }, // *** 确保这里有逗号 ***

 async setShowConnectionTags(req: Request, res: Response): Promise<void> {
   try {
     const { enabled } = req.body;
     console.log('[控制器] 请求体 enabled:', enabled);

     if (typeof enabled !== 'boolean') {
       console.warn('[控制器] 收到无效的 enabled 格式:', enabled);
       res.status(400).json({ message: '无效的请求体，"enabled" 必须是一个布尔值' });
       return;
     }

     
     await settingsService.setShowConnectionTags(enabled, req.authorization!.userId);
     

     auditLogService.logAction('SETTINGS_UPDATED', { updatedKeys: ['showConnectionTags'] });
     notificationService.sendNotification('SETTINGS_UPDATED', { updatedKeys: ['showConnectionTags'] });

     
     res.status(200).json({ message: '“显示连接标签”设置已成功更新' });
   } catch (error: any) {
     console.error('[控制器] 设置“显示连接标签”时出错:', error);
     res.status(500).json({ message: '设置“显示连接标签”失败', error: error.message });
   }
 }, // *** 确保这里有逗号 ***

 // --- Show Quick Command Tags ---
 async getShowQuickCommandTags(req: Request, res: Response): Promise<void> {
   try {
     const isEnabled = await settingsService.getShowQuickCommandTags(req.authorization!.userId);
     res.json({ enabled: isEnabled });
   } catch (error: any) {
     console.error('[控制器] 获取“显示快捷指令标签”设置时出错:', error);
     res.status(500).json({ message: '获取“显示快捷指令标签”设置失败', error: error.message });
   }
 }, // *** 确保这里有逗号 ***

 async setShowQuickCommandTags(req: Request, res: Response): Promise<void> {
   try {
     const { enabled } = req.body;
     console.log('[控制器] 请求体 enabled:', enabled);

     if (typeof enabled !== 'boolean') {
       console.warn('[控制器] 收到无效的 enabled 格式:', enabled);
       res.status(400).json({ message: '无效的请求体，"enabled" 必须是一个布尔值' });
       return;
     }

     
     await settingsService.setShowQuickCommandTags(enabled, req.authorization!.userId);
     

     auditLogService.logAction('SETTINGS_UPDATED', { updatedKeys: ['showQuickCommandTags'] });
     notificationService.sendNotification('SETTINGS_UPDATED', { updatedKeys: ['showQuickCommandTags'] });

     
     res.status(200).json({ message: '“显示快捷指令标签”设置已成功更新' });
   } catch (error: any) {
     console.error('[控制器] 设置“显示快捷指令标签”时出错:', error);
     res.status(500).json({ message: '设置“显示快捷指令标签”失败', error: error.message });
   }
 }, 

 // --- Show Status Monitor IP Address ---
 async getShowStatusMonitorIpAddress(req: Request, res: Response): Promise<void> {
   try {
     const isEnabled = await settingsService.getShowStatusMonitorIpAddress(req.authorization!.userId);
     res.json({ enabled: isEnabled });
   } catch (error: any) {
     console.error('[控制器] 获取“显示状态监视器IP地址”设置时出错:', error);
     res.status(500).json({ message: '获取“显示状态监视器IP地址”设置失败', error: error.message });
   }
 },

 async setShowStatusMonitorIpAddress(req: Request, res: Response): Promise<void> {
   try {
     const { enabled } = req.body;
     console.log('[控制器] 请求体 enabled:', enabled);

     if (typeof enabled !== 'boolean') {
       console.warn('[控制器] 收到无效的 enabled 格式:', enabled);
       res.status(400).json({ message: '无效的请求体，"enabled" 必须是一个布尔值' });
       return;
     }

     
     await settingsService.setShowStatusMonitorIpAddress(enabled, req.authorization!.userId);
     

     auditLogService.logAction('SETTINGS_UPDATED', { updatedKeys: ['showStatusMonitorIpAddress'] });
     notificationService.sendNotification('SETTINGS_UPDATED', { updatedKeys: ['showStatusMonitorIpAddress'] });

     
     res.status(200).json({ message: '“显示状态监视器IP地址”设置已成功更新' });
   } catch (error: any) {
     console.error('[控制器] 设置“显示状态监视器IP地址”时出错:', error);
     res.status(500).json({ message: '设置“显示状态监视器IP地址”失败', error: error.message });
   }
 }, // <-- Add comma here

 /**
  * 导出所有连接配置为加密的 ZIP 文件
  */
  async exportAllConnections(req: Request, res: Response): Promise<void> {
   try {
     const encryptedZipBuffer = await exportConnectionsAsEncryptedZip(req.authorization!, true);

     res.setHeader('Content-Type', 'application/zip');
     res.setHeader('Content-Disposition', 'attachment; filename="fantetic_connections_export.zip"');
     res.send(encryptedZipBuffer);
     
     // auditLogService.logAction('CONNECTIONS_EXPORTED', { userId: (req.user as any)?.id || 'unknown' }); // 移除审计日志
     

   } catch (error: any) {
     console.error('[控制器] 导出所有连接时出错:', error);
     // 检查是否是因为 ENCRYPTION_KEY 未设置导致的错误
     if (error.message && (error.message.includes('ENCRYPTION_KEY is not set') || error.message.includes('Failed to decode ENCRYPTION_KEY') || error.message.includes('Invalid ENCRYPTION_KEY length'))) {
         res.status(500).json({ message: i18next.t('error.exportFailedEncryptionKey'), error: error.message });
     } else {
         res.status(500).json({ message: i18next.t('error.exportFailedGeneric'), error: error.message });
     }
   }
 },

 /**
  * 导入加密 ZIP 连接配置
  */
 async importAllConnections(req: Request, res: Response): Promise<void> {
   const file = req.file as Express.Multer.File | undefined;
   if (!file) {
     res.status(400).json({ message: '未找到上传的 ZIP 文件。' });
     return;
   }

   try {
     const result = await importConnectionsFromEncryptedZip(file.buffer, req.authorization!);
     const status = result.failureCount > 0 ? 207 : 200;
     res.status(status).json({
       message: result.failureCount > 0
         ? `导入完成，但存在 ${result.failureCount} 个错误。成功导入 ${result.successCount} 条，跳过 ${result.skippedCount} 条。`
         : `导入成功完成。共导入 ${result.successCount} 条连接，跳过 ${result.skippedCount} 条。`,
       ...result,
     });
   } catch (error: any) {
     console.error('[控制器] 导入连接 ZIP 时出错:', error);
     if (error.message && (error.message.includes('ENCRYPTION_KEY is not set') || error.message.includes('ZIP 解压密码错误'))) {
       res.status(400).json({ message: '导入失败：无法使用当前 ENCRYPTION_KEY 解压该 ZIP 文件。', error: error.message });
       return;
     }
     res.status(500).json({ message: '导入连接 ZIP 失败', error: error.message });
   }
 } // <-- No comma after the last method if it's truly the last one

};
