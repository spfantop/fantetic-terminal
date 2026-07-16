import nodemailer from "nodemailer";
import Mail from "nodemailer/lib/mailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import { INotificationSender } from "../notification.dispatcher.service";
import { ProcessedNotification } from "../notification.processor.service";
import { EmailConfig } from "../../types/notification.types";
import { settingsService } from "../../settings/settings.service";
import { createLogger } from "../../logging/logger";

const logger = createLogger("EmailSender");

class EmailSenderService implements INotificationSender {
  async send(notification: ProcessedNotification): Promise<void> {
    const config = notification.config as EmailConfig;
    const { to, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, from } =
      config;
    const subject = notification.subject || "Notification";
    const body = notification.body;

    if (!to) {
      logger.error("Email notification is missing a recipient");
      throw new Error(
        "Email configuration is incomplete (missing recipient address)."
      );
    }

    try {
      const globalSmtpHost = await settingsService.getSetting("smtpHost");
      const globalSmtpPortStr = await settingsService.getSetting("smtpPort");
      const globalSmtpSecureStr = await settingsService.getSetting(
        "smtpSecure"
      );
      const globalSmtpUser = await settingsService.getSetting("smtpUser");
      const globalSmtpPass = await settingsService.getSetting("smtpPass");
      const globalSmtpFrom = await settingsService.getSetting("smtpFrom");

      const finalSmtpHost = smtpHost || globalSmtpHost;
      const finalSmtpPort =
        smtpPort ?? (globalSmtpPortStr ? parseInt(globalSmtpPortStr, 10) : 587);
      const finalSmtpSecure =
        smtpSecure ?? globalSmtpSecureStr === "true" ?? false;
      const finalSmtpUser = smtpUser || globalSmtpUser;
      const finalSmtpPass = smtpPass || globalSmtpPass;
      const finalFrom =
        from || globalSmtpFrom || "noreply@fantetic-terminal.local";

      if (!finalSmtpHost) {
        logger.error("Email notification SMTP host is not configured");
        throw new Error("SMTP host configuration is missing.");
      }

      if (isNaN(finalSmtpPort) || finalSmtpPort <= 0) {
        logger.error("Email notification SMTP port is invalid");

        throw new Error(`Invalid SMTP port configured: ${finalSmtpPort}`);
      }

      const transporterOptions: SMTPTransport.Options = {
        host: finalSmtpHost,
        port: finalSmtpPort,
        secure: finalSmtpSecure,
        auth:
          finalSmtpUser && finalSmtpPass
            ? {
                user: finalSmtpUser,
                pass: finalSmtpPass,
              }
            : undefined,
        tls: {
          rejectUnauthorized: finalSmtpSecure,

          minVersion: "TLSv1.2",
        },
      };

      const transporter = nodemailer.createTransport(transporterOptions);

      const mailOptions: Mail.Options = {
        from: `"${finalFrom.split("@")[0]}" <${finalFrom}>`,
        to: to,
        subject: subject,

        html: body,
      };

      logger.info("Sending email notification");
      const info = await transporter.sendMail(mailOptions);
      logger.info("Email notification sent", { messageId: info.messageId });
    } catch (error: any) {
      logger.error("Failed to send email notification", { errorName: error instanceof Error ? error.name : 'UnknownError' });

      throw new Error(
        `Failed to send email notification: ${error.message || error}`
      );
    }
  }
}

const emailSenderService = new EmailSenderService();
export default emailSenderService;
