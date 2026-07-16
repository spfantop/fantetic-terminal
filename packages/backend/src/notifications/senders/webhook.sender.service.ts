import axios, { Method } from "axios";
import { INotificationSender } from "../notification.dispatcher.service";
import { ProcessedNotification } from "../notification.processor.service";
import { WebhookConfig } from "../../types/notification.types";
import { createLogger } from "../../logging/logger";

const logger = createLogger("WebhookSender");

class WebhookSenderService implements INotificationSender {
  async send(notification: ProcessedNotification): Promise<void> {
    const config = notification.config as WebhookConfig;
    const { url, method = "POST", headers = {} } = config;
    const requestBody = notification.body;

    if (!url) {
      logger.error("Webhook notification is missing a URL");
      throw new Error("Webhook configuration is incomplete (missing URL).");
    }

    try {
      new URL(url);
    } catch {
      logger.error("Webhook notification URL is invalid");
      throw new Error(`Invalid webhook URL format: ${url}`);
    }

    const finalHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...headers,
    };

    const requestMethod: Method = method.toUpperCase() as Method;
    const validMethods: Method[] = [
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "PATCH",
      "HEAD",
      "OPTIONS",
    ];
    if (!validMethods.includes(requestMethod)) {
      logger.error("Webhook notification HTTP method is invalid", { method });

      throw new Error(`Invalid HTTP method specified: ${method}`);
    }

    try {
      logger.info("Sending webhook notification", { method: requestMethod });

      let requestData: any = undefined;
      let requestParams: any = undefined;

      if (["POST", "PUT", "PATCH"].includes(requestMethod)) {
        if (
          finalHeaders["Content-Type"]
            ?.toLowerCase()
            .includes("application/json")
        ) {
          try {
            requestData = JSON.parse(requestBody);
          } catch {
            logger.warn("Webhook notification body is not valid JSON; sending raw content", { method: requestMethod });
            requestData = requestBody;
          }
        } else {
          requestData = requestBody;
        }
      } else if (requestMethod === "GET") {
        logger.warn("Webhook notification uses GET with a body", { method: requestMethod });
      }

      const response = await axios({
        method: requestMethod,
        url: url,
        headers: finalHeaders,
        data: requestData,
        params: requestParams,
        timeout: 15000,
      });

      if (response.status >= 200 && response.status < 300) {
        logger.info("Webhook notification sent", { method: requestMethod, status: response.status });
      } else {
        logger.warn("Webhook notification returned a non-success status", { method: requestMethod, status: response.status });
      }
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        logger.error("Webhook notification request failed", { method: requestMethod, status: error.response?.status, errorName: error.name });
        throw new Error(
          `Failed to send webhook notification (Axios Error): ${error.message}`
        );
      } else {
        logger.error("Webhook notification failed unexpectedly", { method: requestMethod, errorName: error instanceof Error ? error.name : 'UnknownError' });
        throw new Error(
          `Failed to send webhook notification (Unexpected Error): ${
            error.message || error
          }`
        );
      }
    }
  }
}

const webhookSenderService = new WebhookSenderService();
export default webhookSenderService;
