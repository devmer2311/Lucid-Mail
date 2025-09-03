"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseReceivedChain = parseReceivedChain;
exports.detectEspType = detectEspType;
function parseReceivedChain(receivedLines) {
    // Received headers are usually newest->oldest top-to-bottom in the raw header block.
    // We want oldest -> newest for a logical path.
    const ordered = [...receivedLines].reverse();
    return ordered.map((line, idx) => {
        const fromMatch = line.match(/from\s+([^\s;()]+)/i);
        const byMatch = line.match(/by\s+([^\s;()]+)/i);
        const ipMatch = line.match(/\[?(\d{1,3}(?:\.\d{1,3}){3})\]?/);
        const dateMatch = line.split(';').pop()?.trim();
        let timestamp = null;
        if (dateMatch) {
            const d = new Date(dateMatch);
            if (!isNaN(d.getTime()))
                timestamp = d.toISOString();
        }
        return {
            index: idx,
            raw: line,
            from: fromMatch ? fromMatch[1] : undefined,
            by: byMatch ? byMatch[1] : undefined,
            ip: ipMatch ? ipMatch[1] : undefined,
            timestamp,
        };
    });
}
function detectEspType(headersObj, receivedLines) {
    // headersObj: object of header-name -> value (as returned by mailparser or imap)
    const signals = [];
    const scores = {
        Gmail: 0,
        Outlook: 0,
        'Amazon SES': 0,
        SendGrid: 0,
        Mailgun: 0,
        Zoho: 0,
        Unknown: 0,
    };
    const headerStr = JSON.stringify(headersObj).toLowerCase();
    const receivedStr = receivedLines.join(' ').toLowerCase();
    // Quick rules
    if (/google/.test(headerStr) || /gmail/.test(headerStr) || /x-google/.test(headerStr)) {
        signals.push('google headers');
        scores.Gmail += 3;
    }
    if (/outlook|office365|microsoft/.test(headerStr) || /spf.protection.outlook/.test(headerStr)) {
        signals.push('microsoft headers');
        scores.Outlook += 3;
    }
    if (/amazonses|amazonaws|ses/.test(headerStr) || /amazonses/.test(receivedStr)) {
        signals.push('amazonses');
        scores['Amazon SES'] += 3;
    }
    if (/sendgrid/.test(headerStr) || /x-sg-/.test(headerStr)) {
        signals.push('sendgrid');
        scores.SendGrid += 3;
    }
    if (/mailgun/.test(headerStr) || /x-mailgun/.test(headerStr)) {
        signals.push('mailgun');
        scores.Mailgun += 3;
    }
    if (/zoho/.test(headerStr)) {
        signals.push('zoho');
        scores.Zoho += 3;
    }
    // Received host hints (lower weight)
    if (/google\.com|mail-.*\.google/.test(receivedStr))
        scores.Gmail += 1;
    if (/outlook|office365/.test(receivedStr))
        scores.Outlook += 1;
    if (/amazonses|amazonses\.com/.test(receivedStr))
        scores['Amazon SES'] += 1;
    // Pick best
    const winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    const type = winner && winner[1] > 0 ? winner[0] : 'Unknown';
    // rough confidence: winnerScore / maxPossible (6)
    const confidence = Math.min(1, (winner ? winner[1] : 0) / 6);
    return { type, confidence, signals };
}
//# sourceMappingURL=email.utils.js.map