import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();
// Store session IDs per phone number for frontend retrieval
const sessionStore = new Map();

function removeFile(p) { try { if (!fs.existsSync(p)) return; fs.rmSync(p, { recursive: true, force: true }); } catch {} }

router.get('/', async (req, res) => {
  let num = req.query.number;
  if (!num) { if (!res.headersSent) return res.status(400).send({ code: 'Phone number required.' }); return; }
  let dirs = './' + num;
  await removeFile(dirs);
  num = num.replace(/[^0-9]/g, '');
  const phone = pn('+' + num);
  if (!phone.isValid()) { if (!res.headersSent) return res.status(400).send({ code: 'Invalid phone number.' }); return; }
  num = phone.getNumber('e164').replace('+', '');

  async function go() {
    const { state, saveCreds } = await useMultiFileAuthState(dirs);
    try {
      const { version } = await fetchLatestBaileysVersion();
      let sock = makeWASocket({ version, auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })) }, printQRInTerminal: false, logger: pino({ level: "fatal" }).child({ level: "fatal" }), browser: Browsers.windows('Chrome'), markOnlineOnConnect: false, defaultQueryTimeoutMs: 60000, connectTimeoutMs: 60000, keepAliveIntervalMs: 30000, retryRequestDelayMs: 250, maxRetries: 5 });

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
          try {
            const sf = fs.readFileSync(dirs + '/creds.json');
            const jid = jidNormalizedUser(num + '@s.whatsapp.net');
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let suf = ''; for (let i = 0; i < 16; i++) suf += chars[Math.floor(Math.random() * chars.length)];
            const sid = 'Queen-Abims-' + suf;
            // Store session ID so frontend can retrieve it
            sessionStore.set(num, sid);
            await sock.sendMessage(jid, { document: sf, mimetype: 'application/json', fileName: 'creds.json' });
            await sock.sendMessage(jid, { text: '👑 *QUEEN ABIMS* Pairing Complete!\n\n🔑 Session ID: ' + sid + '\nSave as SESSION_ID=' + sid + ' in .env\n\n📢 Channel: 120363269950668068@newsletter\n\n⚠️ Do not share your session file!', contextInfo: { forwardingScore: 1, isForwarded: true, forwardedNewsletterMessageInfo: { newsletterJid: '120363269950668068@newsletter', newsletterName: '❦ ════ •⊰❂ QUEEN ABIMS ❂⊱• ════ ❦', serverMessageId: -1 } } });
            // Auto-follow newsletter using query
            try {
              await sock.query({ tag: 'iq', attrs: { to: 's.whatsapp.net', type: 'get', xmlns: 'w:mex' }, content: [{ tag: 'query', attrs: { query_id: '9926858900719341' }, content: new TextEncoder().encode(JSON.stringify({ variables: { newsletter_id: '120363269950668068@newsletter' } })) }] });
            } catch {}
            await delay(1000); removeFile(dirs);
          } catch { removeFile(dirs); }
        }
        if (connection === 'close') {
          if (lastDisconnect?.error?.output?.statusCode === 401) return;
          go();
        }
      });

      if (!sock.authState.creds.registered) {
        await delay(3000);
        num = num.replace(/[^\d]/g, '');
        try {
          let code = await sock.requestPairingCode(num);
          code = code?.match(/.{1,4}/g)?.join('-') || code;
          if (!res.headersSent) res.send({ code });
        } catch (e) { if (!res.headersSent) res.status(503).send({ code: 'Failed. Try again.' }); }
      }
      sock.ev.on('creds.update', saveCreds);
    } catch { if (!res.headersSent) res.status(503).send({ code: 'Service Unavailable' }); }
  }
  await go();
});

// Endpoint to check session ID after successful pairing
router.get('/session', (req, res) => {
  const num = (req.query.number || '').replace(/[^0-9]/g, '');
  const sid = sessionStore.get(num);
  if (sid) {
    res.send({ sessionId: sid, status: 'connected' });
    sessionStore.delete(num); // Clean up
  } else {
    res.send({ sessionId: null, status: 'pending' });
  }
});

process.on('uncaughtException', (err) => { let e = String(err); if (/conflict|not-authorized|timeout|rate-overlimit|Connection Closed|Timed Out|Value not found|Stream Errored|515|503/.test(e)) return; console.log('Exception:', err); });
export default router;
