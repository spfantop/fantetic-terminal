import axios from "axios";
import { INotificationSender } from "../notification.dispatcher.service";
import { ProcessedNotification } from "../notification.processor.service";
import { TelegramConfig } from "../../types/notification.types";
import { createLogger } from "../../logging/logger";

const logger = createLogger("TelegramSender");

class TelegramSenderService implements INotificationSender {
  async send(notification: ProcessedNotification): Promise<void> {
    const config = notification.config as TelegramConfig;
    const { botToken, chatId, customDomain } = config; // Destructure customDomain
    const messageBody = notification.body;

    if (!botToken || !chatId) {
      logger.error("Telegram notification is missing required configuration");
      throw new Error(
        "Telegram configuration is incomplete (missing botToken or chatId)."
      );
    }

    let baseApiUrl = "https://api.telegram.org";
    if (customDomain) {
        try {
            const url = new URL(customDomain); // Validate and parse the custom domain
            baseApiUrl = `${url.protocol}//${url.host}`; // Use protocol and host from customDomain
            logger.info("Telegram notification custom domain accepted");
        } catch {
            logger.warn("Telegram notification custom domain is invalid");
            // Optionally, you could throw an error here or decide to proceed with the default
        }
    }

    const apiUrl = `${baseApiUrl}/bot${botToken}/sendMessage`;

    try {
      logger.info("Sending Telegram notification");
      const response = await axios.post(
        apiUrl,
        {
          chat_id: chatId,
          text: messageBody,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
        },
        {
          timeout: 10000,
        }
      );

      if (response.data && response.data.ok) {
        logger.info("Telegram notification sent");
      } else {
        const errorDescription =
          response.data?.description || "Unknown error from Telegram API";
        logger.error("Telegram notification API reported failure");
        throw new Error(`Telegram API error: ${errorDescription}`);
      }
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        logger.error("Telegram notification request failed", { status: error.response?.status, errorName: error.name });
        throw new Error(
          `Failed to send Telegram notification (Axios Error): ${error.message}`
        );
      } else {
        logger.error("Telegram notification failed unexpectedly", { errorName: error instanceof Error ? error.name : 'UnknownError' });
        throw new Error(
          `Failed to send Telegram notification (Unexpected Error): ${
            error.message || error
          }`
        );
      }
    }
  }
}

const telegramSenderService = new TelegramSenderService();
export default telegramSenderService;
