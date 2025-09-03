"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var EmailService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const email_schema_1 = require("./email.schema");
const imaps = __importStar(require("imap-simple"));
const mailparser_1 = require("mailparser");
const email_utils_1 = require("./email.utils");
const uuid_1 = require("uuid");
let EmailService = EmailService_1 = class EmailService {
    constructor(emailModel) {
        this.emailModel = emailModel;
        this.logger = new common_1.Logger(EmailService_1.name);
        this.polling = false;
    }
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
        const token = 'LGTEST-' + (0, uuid_1.v4)().slice(0, 8).toUpperCase();
        return {
            testEmail: process.env.IMAP_USER,
            subjectToken: token,
        };
    }
    // Public: get latest processed email by token
    async getLatestByToken(token) {
        if (!token)
            return null;
        return this.emailModel.findOne({ subjectToken: token }).sort({ processedAt: -1 }).lean();
    }
    async listAll() {
        return this.emailModel.find().sort({ processedAt: -1 }).lean();
    }
    // Poll IMAP for unseen messages, process them
    async checkNewMessages() {
        if (!this.imapConn || this.polling)
            return;
        this.polling = true;
        try {
            // search for unseen messages
            const searchCriteria = ['UNSEEN'];
            const fetchOptions = { bodies: [''], markSeen: false }; // fetch raw source
            const messages = await this.imapConn.search(searchCriteria, fetchOptions);
            for (const msg of messages) {
                try {
                    const all = msg.parts.find((p) => p.which === '');
                    const raw = all?.body || msg.attributes?.struct?.toString() || '';
                    // parse raw message to get headers
                    const parsed = await (0, mailparser_1.simpleParser)(raw);
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
                    const receivedHeaders = [];
                    if (parsed.headerLines) {
                        for (const h of parsed.headerLines) {
                            if (h.line.toLowerCase().startsWith('received:')) {
                                receivedHeaders.push(h.line.replace(/^received:\s*/i, ''));
                            }
                        }
                    }
                    else if (parsed.headers) {
                        // parsed.headers is a Map in some versions
                        try {
                            const headersMap = parsed.headers;
                            const rec = headersMap.get('received');
                            if (rec) {
                                if (Array.isArray(rec)) {
                                    for (const r of rec)
                                        receivedHeaders.push(r);
                                }
                                else {
                                    receivedHeaders.push(rec);
                                }
                            }
                        }
                        catch (e) {
                            // fallback: try raw header search
                            const rawText = raw.toString ? raw.toString('utf-8') : String(raw);
                            const matches = rawText.match(/Received:[\s\S]*?;\s*\w{3},.*\n/g);
                            if (matches) {
                                for (const m of matches)
                                    receivedHeaders.push(m.replace(/^Received:\s*/i, '').trim());
                            }
                        }
                    }
                    const receivingChain = (0, email_utils_1.parseReceivedChain)(receivedHeaders);
                    const esp = (0, email_utils_1.detectEspType)(parsed.headers || parsed, receivedHeaders);
                    // Save to DB
                    const doc = await this.emailModel.create({
                        subject,
                        subjectToken,
                        from: parsed.from ? parsed.from.value : undefined,
                        to: parsed.to ? parsed.to.value : undefined,
                        date: parsed.date || new Date(),
                        rawHeaders: parsed.headerLines ? parsed.headerLines.map((h) => h.line).join('\n') : '',
                        receivingChain,
                        esp,
                        processedAt: new Date(),
                    });
                    this.logger.log(`Saved email for token=${subjectToken}, id=${doc._id}`);
                    // mark message seen
                    if (msg.attributes && msg.attributes.uid) {
                        await this.imapConn.addFlags(msg.attributes.uid, '\\Seen');
                    }
                }
                catch (innerErr) {
                    this.logger.error('Error processing single message', innerErr);
                }
            }
        }
        catch (err) {
            this.logger.error('Error while checking IMAP messages', err);
        }
        finally {
            this.polling = false;
        }
    }
    // Very simple token extractor: looks for LGTEST-XXXX in subject
    extractTokenFromSubject(subject) {
        if (!subject)
            return null;
        const m = subject.match(/(LGTEST-[A-Z0-9]{1,20})/i);
        return m ? m[1].toUpperCase() : null;
    }
};
exports.EmailService = EmailService;
exports.EmailService = EmailService = EmailService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)(email_schema_1.Email.name)),
    __metadata("design:paramtypes", [mongoose_2.Model])
], EmailService);
//# sourceMappingURL=email.service.js.map