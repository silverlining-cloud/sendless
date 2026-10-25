import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import type { Logger } from '../log.js';
import type { Mailer, MailMessage } from '../ports.js';

export class SesMailer implements Mailer {
  readonly enabled = true;
  private readonly ses: SESv2Client;

  constructor(
    private readonly from: string,
    region: string,
  ) {
    this.ses = new SESv2Client({ region });
  }

  async send(message: MailMessage) {
    await this.ses.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [message.to] },
        ...(message.replyTo ? { ReplyToAddresses: [message.replyTo] } : {}),
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: { Text: { Data: message.text, Charset: 'UTF-8' }, Html: { Data: message.html, Charset: 'UTF-8' } },
          },
        },
      }),
    );
  }
}

export const disabledMailer: Mailer = {
  enabled: false,
  async send() {
    throw new Error('Email is not configured');
  },
};

/** Dev: prints emails instead of sending them. */
export class ConsoleMailer implements Mailer {
  readonly enabled = true;
  readonly sent: MailMessage[] = [];

  constructor(private readonly log?: Logger) {}

  async send(message: MailMessage) {
    this.sent.push(message);
    this.log?.info('email (not sent, dev mode)', { to: message.to, subject: message.subject, text: message.text });
  }
}
