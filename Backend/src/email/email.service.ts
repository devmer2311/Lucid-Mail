import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Email, EmailDocument } from './email.schema';
import * as imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import { parseReceivedChain, detectEspType } from './email.utils';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private imapConn: any;
  private polling = false;

  constructor(@InjectModel(Email.name) private emailModel: Model<EmailDocument>) {}

  onModuleInit() {
    // Start the IMAP poller when module is ready
    this.startImapPoller().catch(err => this.logger.error('IMAP poller failed to start', err));
  }

  async startImapPoller() {
   const config = {
  imap: {
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASSWORD,
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT),
    tls: process.env.IMAP_TLS === 'true', 
    authTimeout: 10000,
    debug: console.log,
    
  },
};


    this.logger.log('Connecting to IMAP (GMX)...');
    this.imapConn = await imaps.connect(config);
    await this.imapConn.openBox('INBOX');
    this.logger.log('Connected to IMAP INBOX.');

    // Polling loop
    const ms = Number(process.env.POLL_INTERVAL_MS || 8000);
    setInterval(() => this.checkNewMessages().catch(err => this.logger.error(err)), ms);
    // Run immediate check once
    await this.checkNewMessages();
  }

  // Create a new session token + return mailbox to show to user
  createSession() {
    const token = 'LGTEST-' + uuidv4().slice(0, 8).toUpperCase();
    return {
      testEmail: process.env.IMAP_USER,
      subjectToken: token,
    };
  }

  // Public: get latest processed email by token
  async getLatestByToken(token: string) {
    if (!token) return null;
    return this.emailModel.findOne({ subjectToken: token }).sort({ processedAt: -1 }).lean();
  }

  async listAll() {
    return this.emailModel.find().sort({ processedAt: -1 }).lean();
  }

  // Poll IMAP for unseen messages, process them
  private async checkNewMessages() {
    if (!this.imapConn || this.polling) return;
    this.polling = true;
    try {
      // search for unseen messages
      const searchCriteria = ['UNSEEN'];
      const fetchOptions = { bodies: [''], markSeen: false }; // fetch raw source
      const messages = await this.imapConn.search(searchCriteria, fetchOptions);

      for (const msg of messages) {
        try {
          const all = msg.parts.find((p: any) => p.which === '');
          const raw = all?.body || msg.attributes?.struct?.toString() || '';
          // parse raw message to get headers
          const parsed = await simpleParser(raw);
          const subject = parsed.subject || '';
          const subjectToken = this.extractTokenFromSubject(subject);
          if (!subjectToken) {
            this.logger.debug(`No subject token found in subject: "${subject}", skipping.`);
            // mark seen to avoid repeated scanning (optional)
            if (msg.attributes && msg.attributes.uid) {
              await this.imapConn.addFlags(msg.attributes.uid, '\\Seen');
            }
            continue;
          }

          // Collect Received headers;
          const receivedHeaders: string[] = [];
          
          if ((parsed as any).headerLines) {
            for (const h of (parsed as any).headerLines) {
              if (h.line.toLowerCase().startsWith('received:')) {
                receivedHeaders.push(h.line.replace(/^received:\s*/i, ''));
              }
            }
          } else if (parsed.headers) {
            // parsed.headers is a Map in some versions
            try {
              const headersMap = parsed.headers;
              const rec = headersMap.get('received');
              if (rec) {
                if (Array.isArray(rec)) {
                  for (const r of rec) receivedHeaders.push(r);
                } else {
                  receivedHeaders.push(rec);
                }
              }
            } catch (e) {
              // fallback: try raw header search
              const rawText = raw.toString ? raw.toString('utf-8') : String(raw);
              const matches = rawText.match(/Received:[\s\S]*?;\s*\w{3},.*\n/g);
              if (matches) {
                for (const m of matches) receivedHeaders.push(m.replace(/^Received:\s*/i, '').trim());
              }
            }
          }

          const receivingChain = parseReceivedChain(receivedHeaders);
          const esp = detectEspType(parsed.headers || parsed, receivedHeaders);

          // Save to DB
          const doc = await this.emailModel.create({
            subject,
            subjectToken,
            from: parsed.from ? parsed.from.value : undefined,
            to: parsed.to ? parsed.to.value : undefined,
            date: parsed.date || new Date(),
            rawHeaders: parsed.headerLines ? parsed.headerLines.map((h:any)=>h.line).join('\n') : '',
            receivingChain,
            esp,
            processedAt: new Date(),
          });

          this.logger.log(`Saved email for token=${subjectToken}, id=${doc._id}`);

          // mark message seen
          if (msg.attributes && msg.attributes.uid) {
            await this.imapConn.addFlags(msg.attributes.uid, '\\Seen');
          }
        } catch (innerErr) {
          this.logger.error('Error processing single message', innerErr);
        }
      }
    } catch (err) {
      this.logger.error('Error while checking IMAP messages', err);
    } finally {
      this.polling = false;
    }
  }

  // Very simple token extractor: looks for LGTEST-XXXX in subject
  private extractTokenFromSubject(subject?: string): string | null {
    if (!subject) return null;
    const m = subject.match(/(LGTEST-[A-Z0-9]{1,20})/i);
    return m ? m[1].toUpperCase() : null;
  }
}
