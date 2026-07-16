import axios, { AxiosRequestConfig } from "axios";
import { NotificationSettingsRepository } from "../notifications/notification.repository";
import {
  NotificationSetting,
  NotificationEvent,
  NotificationPayload,
  WebhookConfig,
  EmailConfig,
  TelegramConfig,
  NotificationChannelConfig,
  NotificationChannelType,
} from "../types/notification.types";
import * as nodemailer from "nodemailer";
import Mail from "nodemailer/lib/mailer";
import i18next, { defaultLng, supportedLngs } from "../i18n";
import { settingsService } from "../settings/settings.service";
import { formatInTimeZone } from "date-fns-tz";
import { createLogger } from "../logging/logger";

const logger = createLogger("NotificationService");

const testSubjectKey = "testNotification.subject";
const testEmailBodyKey = "testNotification.email.body";
const testEmailBodyHtmlKey = "testNotification.email.bodyHtml";
const testWebhookDetailsKey = "testNotification.webhook.detailsMessage";
const testTelegramDetailsKey = "testNotification.telegram.detailsMessage";
const testTelegramBodyTemplateKey = "testNotification.telegram.bodyTemplate";

export class NotificationService {
  private repository: NotificationSettingsRepository;

  constructor() {
    this.repository = new NotificationSettingsRepository();
  }

  async getAllSettings(): Promise<NotificationSetting[]> {
    return this.repository.getAll();
  }

  async getSettingById(id: number): Promise<NotificationSetting | null> {
    return this.repository.getById(id);
  }

  async createSetting(
    settingData: Omit<NotificationSetting, "id" | "created_at" | "updated_at">
  ): Promise<number> {
    return this.repository.create(settingData);
  }

  async updateSetting(
    id: number,
    settingData: Partial<
      Omit<NotificationSetting, "id" | "created_at" | "updated_at">
    >
  ): Promise<boolean> {
    return this.repository.update(id, settingData);
  }

  async deleteSetting(id: number): Promise<boolean> {
    return this.repository.delete(id);
  }

  async testSetting(
    channelType: NotificationChannelType,
    config: NotificationChannelConfig
  ): Promise<{ success: boolean; message: string }> {
    switch (channelType) {
      case "email":
        return this._testEmailSetting(config as EmailConfig);
      case "webhook":
        return this._testWebhookSetting(config as WebhookConfig);
      case "telegram":
        return this._testTelegramSetting(config as TelegramConfig);
      default:
        logger.warn("Unsupported notification test channel", { channelType });
        return {
          success: false,
          message: `不支持测试此渠道类型 (${channelType})`,
        };
    }
  }

  private async _testEmailSetting(
    config: EmailConfig
  ): Promise<{ success: boolean; message: string }> {
    logger.info("Email notification test started");
    if (!config.to || !config.smtpHost || !config.smtpPort || !config.from) {
      logger.error("Email notification test is missing required configuration");
      return {
        success: false,
        message:
          "测试邮件失败：缺少必要的 SMTP 配置信息 (收件人, 主机, 端口, 发件人)。",
      };
    }

    let userLang = defaultLng;
    try {
      const langSetting = await settingsService.getSetting("language");
      if (langSetting && supportedLngs.includes(langSetting)) {
        userLang = langSetting;
      }
      logger.debug("Email notification test language resolved", { userLang });
    } catch (error) {
      logger.error("Failed to resolve email notification test language", { error });
    }

    const transporterOptions = {
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure ?? true,
      auth:
        config.smtpUser || config.smtpPass
          ? {
              user: config.smtpUser,
              pass: config.smtpPass,
            }
          : undefined,
    };

    const transporter = nodemailer.createTransport(transporterOptions);

    const eventDisplayName = i18next.t(`event.SETTINGS_UPDATED`, {
      lng: userLang,
      defaultValue: "SETTINGS_UPDATED",
    });

    const mailOptions: Mail.Options = {
      from: config.from,
      to: config.to,
      subject: i18next.t(testSubjectKey, {
        lng: userLang,
        defaultValue: "Fantetic Terminal Test Notification ({event})",
        eventDisplay: eventDisplayName,
      }),
      text: i18next.t(testEmailBodyKey, {
        lng: userLang,
        timestamp: new Date().toISOString(),
        defaultValue: `This is a test email from Fantetic Terminal for event '{{event}}'.\n\nIf you received this, your SMTP configuration is working.\n\nTimestamp: {{timestamp}}`,
        eventDisplay: eventDisplayName,
      }),
      html: i18next.t(testEmailBodyHtmlKey, {
        lng: userLang,
        timestamp: new Date().toISOString(),
        defaultValue: `<p>This is a test email from <b>Fantetic Terminal</b> for event '{{event}}'.</p><p>If you received this, your SMTP configuration is working.</p><p>Timestamp: {{timestamp}}</p>`,
        eventDisplay: eventDisplayName,
      }),
    };

    try {
      logger.info("Sending email notification test");
      const info = await transporter.sendMail(mailOptions);
      logger.info("Email notification test sent", { messageId: info.messageId });
      return { success: true, message: "测试邮件发送成功！请检查收件箱。" };
    } catch (error: any) {
      logger.error("Failed to send email notification test", { error });
      return {
        success: false,
        message: `测试邮件发送失败: ${error.message || "未知错误"}`,
      };
    }
  }

  private async _testWebhookSetting(
    config: WebhookConfig
  ): Promise<{ success: boolean; message: string }> {
    logger.info("Webhook notification test started");
    if (!config.url) {
      logger.error("Webhook notification test is missing URL");
      return { success: false, message: "测试 Webhook 失败：缺少 URL。" };
    }

    let userLang = defaultLng;
    try {
      const langSetting = await settingsService.getSetting("language");
      if (langSetting && supportedLngs.includes(langSetting)) {
        userLang = langSetting;
      }
      logger.debug("Webhook notification test language resolved", { userLang });
    } catch (error) {
      logger.error("Failed to resolve webhook notification test language", { error });
    }

    const testPayload: NotificationPayload = {
      event: "SETTINGS_UPDATED",
      timestamp: Date.now(),
      details: {
        message: i18next.t(testWebhookDetailsKey, {
          lng: userLang,
          defaultValue:
            "This is a test notification from Fantetic Terminal (Webhook).",
        }),
      },
    };
    const eventDisplayName = i18next.t(`event.${testPayload.event}`, {
      lng: userLang,
      defaultValue: testPayload.event,
    });
    const defaultBody = JSON.stringify(testPayload, null, 2);
    const defaultBodyTemplate = `Default: JSON payload. Use {event}, {timestamp}, {details}.`;

    const templateDataWebhookTest: Record<string, string> = {
      event: testPayload.event,
      eventDisplay: eventDisplayName,
      timestamp: new Date(testPayload.timestamp).toISOString(),

      details:
        typeof testPayload.details === "object" && testPayload.details?.message
          ? testPayload.details.message
          : typeof testPayload.details === "string"
          ? testPayload.details
          : JSON.stringify(testPayload.details || {}, null, 2),
    };
    const requestBody = this._renderTemplate(
      config.bodyTemplate || defaultBodyTemplate,
      templateDataWebhookTest,
      defaultBody
    );

    const requestConfig: AxiosRequestConfig = {
      method: config.method || "POST",
      url: config.url,
      headers: {
        "Content-Type": "application/json",
        ...(config.headers || {}),
      },
      data: requestBody,
      timeout: 15000,
    };

    try {
      logger.info("Sending webhook notification test", { method: requestConfig.method });
      const response = await axios(requestConfig);
      logger.info("Webhook notification test sent", { status: response.status });
      return {
        success: true,
        message: `测试 Webhook 发送成功 (状态码: ${response.status})。`,
      };
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.message ||
        error.response?.data ||
        error.message ||
        "未知错误";
      logger.error("Failed to send webhook notification test", { error });
      return {
        success: false,
        message: `测试 Webhook 发送失败: ${errorMessage}`,
      };
    }
  }

  private async _testTelegramSetting(
    config: TelegramConfig
  ): Promise<{ success: boolean; message: string }> {
    logger.info("Telegram notification test started");
    if (!config.botToken || !config.chatId) {
      logger.error("Telegram notification test is missing required configuration");
      return {
        success: false,
        message: "测试 Telegram 失败：缺少机器人 Token 或聊天 ID。",
      };
    }

    let userLang = defaultLng;
    try {
      const langSetting = await settingsService.getSetting("language");
      if (langSetting && supportedLngs.includes(langSetting)) {
        userLang = langSetting;
      }
      logger.debug("Telegram notification test language resolved", { userLang });
    } catch (error) {
      logger.error("Failed to resolve Telegram notification test language", { error });
    }

    const testPayload: NotificationPayload = {
      event: "SETTINGS_UPDATED",
      timestamp: Date.now(),
      details: undefined,
    };

    const detailsOptions = {
      lng: userLang,
      defaultValue:
        "Fallback: This is a test notification from Fantetic Terminal (Telegram).",
    };
    const keyWithNamespace = `notifications:${testTelegramDetailsKey}`;
    const translatedDetailsMessage = i18next.t(
      keyWithNamespace,
      detailsOptions
    );

    testPayload.details = { message: translatedDetailsMessage };

    const messageFromPayload =
      typeof testPayload.details === "object" && testPayload.details?.message
        ? testPayload.details.message
        : "Details is not an object with message property";

    const templateKeyWithNamespace = `notifications:${testTelegramBodyTemplateKey}`;
    const defaultMessageTemplateFromI18n = i18next.t(templateKeyWithNamespace, {
      lng: userLang,
      defaultValue: `Fallback Template: *Fantetic Terminal Test Notification*\nEvent: \`{event}\`\nTimestamp: {timestamp}\nDetails:\n\`\`\`\n{details}\n\`\`\``,
    });

    const templateToUse =
      config.messageTemplate || defaultMessageTemplateFromI18n;

    const eventDisplayName = i18next.t(`event.${testPayload.event}`, {
      lng: userLang,
      defaultValue: testPayload.event,
    });

    const templateDataTelegramTest: Record<string, string> = {
      event: this._escapeBasicMarkdown(testPayload.event),
      eventDisplay: this._escapeBasicMarkdown(eventDisplayName),
      timestamp: new Date(testPayload.timestamp).toISOString(),

      details: this._escapeBasicMarkdown(messageFromPayload),
    };

    const messageText = this._renderTemplate(
      templateToUse,
      templateDataTelegramTest,
      defaultMessageTemplateFromI18n
    );

    let baseApiUrl = "https://api.telegram.org";
    if (config.customDomain) {
        try {
            const url = new URL(config.customDomain);
            baseApiUrl = `${url.protocol}//${url.host}`;
            logger.info("Telegram notification test custom domain accepted");
        } catch (e) {
            logger.warn("Telegram notification test custom domain is invalid");
        }
    }
    const telegramApiUrl = `${baseApiUrl}/bot${config.botToken}/sendMessage`;

    try {
      logger.info("Sending Telegram notification test");
      const response = await axios.post(
        telegramApiUrl,
        {
          chat_id: config.chatId,
          text: messageText,
          parse_mode: "Markdown",
        },
        { timeout: 15000 }
      );

      if (response.data?.ok) {
        logger.info("Telegram notification test sent");
        return { success: true, message: "测试 Telegram 消息发送成功！" };
      } else {
        logger.error("Telegram notification test API reported failure");
        return {
          success: false,
          message: `测试 Telegram 发送失败: ${
            response.data?.description || "API 返回失败"
          }`,
        };
      }
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.description ||
        error.response?.data ||
        error.message ||
        "未知错误";
      logger.error("Failed to send Telegram notification test", { error });
      return {
        success: false,
        message: `测试 Telegram 发送失败: ${errorMessage}`,
      };
    }
  }

  async sendNotification(
    event: NotificationEvent,
    details?: Record<string, any> | string
  ): Promise<void> {
    let userLang = defaultLng;
    let userTimezone = "UTC";
    try {
      const [langSetting, timezoneSetting] = await Promise.all([
        settingsService.getSetting("language"),
        settingsService.getSetting("timezone"),
      ]);
      if (langSetting && supportedLngs.includes(langSetting)) {
        userLang = langSetting;
      }

      if (timezoneSetting) {
        userTimezone = timezoneSetting;
      }
    } catch (error) {
      logger.error("Failed to resolve notification locale settings", { event, error });
    }
    logger.debug("Notification locale settings resolved", { event, userLang, userTimezone });

    const payload: NotificationPayload = {
      event,
      timestamp: Date.now(),
      details: details || undefined,
    };

    try {
      const applicableSettings = await this.repository.getEnabledByEvent(event);
      logger.info("Notification settings resolved for event", { event, settingCount: applicableSettings.length });

      if (applicableSettings.length === 0) {
        return; // 此事件没有启用的设置
      }

      const sendPromises = applicableSettings.map((setting) => {
        switch (setting.channel_type) {
          case "webhook":
            return this._sendWebhook(setting, payload, userLang, userTimezone);
          case "email":
            return this._sendEmail(setting, payload, userLang, userTimezone);
          case "telegram":
            return this._sendTelegram(setting, payload, userLang, userTimezone);
          default:
            logger.warn("Unsupported notification channel", { settingId: setting.id, channelType: setting.channel_type });
            return Promise.resolve();
        }
      });

      await Promise.allSettled(sendPromises);
      logger.info("Notification dispatch attempts completed", { event });
    } catch (error) {
      logger.error("Failed to process notification settings", { event, error });
    }
  }

  private _escapeBasicMarkdown(text: string): string {
    if (typeof text !== "string") return "";

    return text.replace(/([*_`\[])/g, "\\$1");
  }

  private _renderTemplate(
    template: string | undefined,
    data: Record<string, string>,
    defaultText: string
  ): string {
    if (!template) return defaultText;
    let rendered = template;
    for (const key in data) {
      rendered = rendered.replace(new RegExp(`\\{${key}\\}`, "g"), data[key]);
    }
    return rendered;
  }

  private async _sendWebhook(
    setting: NotificationSetting,
    payload: NotificationPayload,
    userLang: string,
    userTimezone: string
  ): Promise<void> {
    const config = setting.config as WebhookConfig;
    if (!config.url) {
      logger.error("Webhook notification setting is missing URL", { settingId: setting.id });
      return;
    }

    const eventDisplayName = i18next.t(`event.${payload.event}`, {
      lng: userLang,
      defaultValue: payload.event,
    });

    const translatedDetails = this._translatePayloadDetails(
      payload.details,
      userLang
    );
    const translatedPayload = { ...payload, details: translatedDetails };

    const defaultBody = JSON.stringify(translatedPayload, null, 2);
    const defaultBodyTemplate = `Default: JSON payload. Use {event}, {timestamp}, {details}.`;

    const templateDataWebhook: Record<string, string> = {
      event: translatedPayload.event,
      eventDisplay: eventDisplayName,

      timestamp: formatInTimeZone(
        new Date(translatedPayload.timestamp),
        userTimezone,
        "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"
      ),

      details:
        typeof translatedPayload.details === "object" &&
        translatedPayload.details?.message
          ? translatedPayload.details.message
          : typeof translatedPayload.details === "string"
          ? translatedPayload.details
          : JSON.stringify(translatedPayload.details || {}, null, 2),
    };
    let templateToRender = config.bodyTemplate || defaultBodyTemplate;
    let isCustomTemplate = !!config.bodyTemplate;

    if (isCustomTemplate) {
      templateToRender = templateToRender.replace(
        /\{event\}/g,
        "{eventDisplay}"
      );
    } else {
      logger.debug("Webhook notification is using the default template", { event: payload.event, settingId: setting.id });
    }

    const requestBody = this._renderTemplate(
      templateToRender,
      templateDataWebhook,
      defaultBody
    );

    const requestConfig: AxiosRequestConfig = {
      method: config.method || "POST",
      url: config.url,
      headers: {
        "Content-Type": "application/json",
        ...(config.headers || {}),
      },
      data: requestBody,
      timeout: 10000,
    };

    try {
      logger.info("Sending webhook notification", { event: payload.event, settingId: setting.id, method: requestConfig.method });
      const response = await axios(requestConfig);
      logger.info("Webhook notification sent", { event: payload.event, settingId: setting.id, status: response.status });
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.message || error.response?.data || error.message;
      logger.error("Failed to send webhook notification", { event: payload.event, settingId: setting.id, error });
    }
  }

  private async _sendEmail(
    setting: NotificationSetting,
    payload: NotificationPayload,
    userLang: string,
    userTimezone: string
  ): Promise<void> {
    const config = setting.config as EmailConfig;
    if (!config.to || !config.smtpHost || !config.smtpPort || !config.from) {
      logger.error("Email notification setting is missing required configuration", { settingId: setting.id });
      return;
    }

    const transporterOptions = {
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure ?? true,
      auth:
        config.smtpUser || config.smtpPass
          ? {
              user: config.smtpUser,
              pass: config.smtpPass,
            }
          : undefined,
    };

    const transporter = nodemailer.createTransport(transporterOptions);

    const i18nOptions: Record<string, any> = { lng: userLang };
    if (payload.details && typeof payload.details === "object") {
      Object.assign(i18nOptions, payload.details);
    } else if (payload.details !== undefined) {
      i18nOptions.details = payload.details;
    }

    const eventDisplayName = i18next.t(`event.${payload.event}`, {
      lng: userLang,
      defaultValue: payload.event,
    });

    const subject = eventDisplayName;

    const formattedTimestampForEmail = formatInTimeZone(
      new Date(payload.timestamp),
      userTimezone,
      "yyyy-MM-dd HH:mm:ss zzz"
    );
    const detailsString =
      typeof payload.details === "string"
        ? payload.details
        : JSON.stringify(payload.details || {}, null, 2);

    const templateDataEmailBody: Record<string, string> = {
      event: payload.event,
      eventDisplay: eventDisplayName,
      timestamp: formattedTimestampForEmail,
      details: detailsString,

      ...Object.entries(i18nOptions).reduce((acc, [key, value]) => {
        if (key !== "lng" && typeof value !== "object") {
          acc[key] = String(value);
        }
        return acc;
      }, {} as Record<string, string>),
    };

    let body = "";
    const defaultBodyText = `Event: ${eventDisplayName}\nTimestamp: ${formattedTimestampForEmail}\nDetails:\n${detailsString}`;

    if (config.bodyTemplate) {
      let templateToRender = config.bodyTemplate;
      templateToRender = templateToRender.replace(
        /\{event\}/g,
        "{eventDisplay}"
      );
      body = this._renderTemplate(
        templateToRender,
        templateDataEmailBody,
        defaultBodyText
      );
    } else {
      logger.debug("Email notification is using the default template", { event: payload.event, settingId: setting.id });
      body = defaultBodyText;
    }

    const mailOptions: Mail.Options = {
      from: config.from,
      to: config.to,
      subject: subject,
      text: body,
    };

    try {
      logger.info("Sending email notification", { event: payload.event, settingId: setting.id });
      const info = await transporter.sendMail(mailOptions);
      logger.info("Email notification sent", { event: payload.event, settingId: setting.id, messageId: info.messageId });
    } catch (error: any) {
      logger.error("Failed to send email notification", { event: payload.event, settingId: setting.id, error });
    }
  }

  private async _sendTelegram(
    setting: NotificationSetting,
    payload: NotificationPayload,
    userLang: string,
    userTimezone: string
  ): Promise<void> {
    logger.debug("Preparing Telegram notification", { event: payload.event, settingId: setting.id, userLang, userTimezone });
    const config = setting.config as TelegramConfig;
    if (!config.botToken || !config.chatId) {
      logger.error("Telegram notification setting is missing required configuration", { settingId: setting.id });
      return;
    }

    let detailsText = "";
    if (payload.details) {
      if (
        payload.event === "SETTINGS_UPDATED" &&
        typeof payload.details === "object" &&
        Array.isArray(payload.details.updatedKeys)
      ) {
        detailsText = payload.details.updatedKeys.join(", ");
      } else if (typeof payload.details === "string") {
        detailsText = payload.details;
      } else {
        detailsText = JSON.stringify(payload.details);
      }
    }

    const translatedEventName = i18next.t(`event.${payload.event}`, {
      lng: userLang,
      defaultValue: payload.event,
    });

    const templateData: Record<string, string> = {
      event: translatedEventName,
      timestamp: formatInTimeZone(
        new Date(payload.timestamp),
        userTimezone,
        "yyyy-MM-dd HH:mm:ss zzz"
      ),
      details: detailsText,
    };

    let messageText = "";
    if (config.messageTemplate) {
      const fallbackForCustom = `Event: ${templateData.event}, Details: ${templateData.details}`;
      messageText = this._renderTemplate(
        config.messageTemplate,
        templateData,
        fallbackForCustom
      );
    } else {
      const i18nKey = `eventBody.${payload.event}`;
      const fallbackBody = `*Fallback Notification*\nEvent: ${templateData.event}\nTime: \`${templateData.timestamp}\`\nDetails: ${templateData.details}`;
      messageText = i18next.t(i18nKey, {
        lng: userLang,
        ...templateData,
        defaultValue: fallbackBody,
      });
    }

    let baseApiUrlSend = "https://api.telegram.org";
    if (config.customDomain) {
        try {
            const url = new URL(config.customDomain);
            baseApiUrlSend = `${url.protocol}//${url.host}`;
            logger.info("Telegram notification custom domain accepted", { event: payload.event, settingId: setting.id });
        } catch (e) {
            logger.warn("Telegram notification custom domain is invalid", { event: payload.event, settingId: setting.id });
        }
    }
    const telegramApiUrl = `${baseApiUrlSend}/bot${config.botToken}/sendMessage`;

    try {
      logger.info("Sending Telegram notification", { event: payload.event, settingId: setting.id });
      const requestBody = {
        chat_id: config.chatId,
        text: messageText,
        parse_mode: "Markdown",
      };
      const response = await axios.post(telegramApiUrl, requestBody, {
        timeout: 10000,
      });
      logger.info("Telegram notification sent", { event: payload.event, settingId: setting.id, ok: response.data?.ok === true });
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.description ||
        error.response?.data ||
        error.message;
      logger.error("Failed to send Telegram notification", { event: payload.event, settingId: setting.id, error });
    }
  }

  private _translatePayloadDetails(details: any, lng: string): any {
    if (!details || typeof details !== "object") {
      return details;
    }

    if (details.testResult === "success" && details.connectionName) {
      return {
        ...details,
        message: i18next.t("connection.testSuccess", {
          lng,
          name: details.connectionName,
          defaultValue: `Connection test successful for '${details.connectionName}'!`,
        }),
      };
    }
    if (
      details.testResult === "failed" &&
      details.connectionName &&
      details.error
    ) {
      return {
        ...details,
        message: i18next.t("connection.testFailed", {
          lng,
          name: details.connectionName,
          error: details.error,
          defaultValue: `Connection test failed for '${details.connectionName}': ${details.error}`,
        }),
      };
    }

    if (details.updatedKeys && Array.isArray(details.updatedKeys)) {
      if (details.updatedKeys.includes("ipWhitelist")) {
        return {
          ...details,
          message: i18next.t("settings.ipWhitelistUpdated", {
            lng,
            defaultValue: "IP Whitelist updated successfully.",
          }),
        };
      }
      return {
        ...details,
        message: i18next.t("settings.updated", {
          lng,
          defaultValue: "Settings updated successfully.",
        }),
      };
    }

    return details;
  }
}
