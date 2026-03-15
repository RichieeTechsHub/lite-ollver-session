const express = require("express");
const path = require("path");
const fs = require("fs-extra");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = process.env.PORT || 3000;

const SESSION_PREFIX = process.env.SESSION_PREFIX || "LITE-OLLVER-MD:~";
const SUPPORT_GROUP =
  process.env.SUPPORT_GROUP ||
  "https://chat.whatsapp.com/JKF3XHbmKY47IQZc7d3LB2";
const OWNER_CONTACT =
  process.env.OWNER_CONTACT || "https://wa.me/254740479599";
const GENERATOR_NAME =
  process.env.GENERATOR_NAME || "Lite-Ollver-MD Session Generator";

const logger = pino({ level: "silent" });
const TEMP_ROOT = path.join(__dirname, "temp");
const jobs = new Map();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function cleanNumber(value = "") {
  return String(value).replace(/\D/g, "");
}

function formatPairCode(code = "") {
  return code.match(/.{1,4}/g)?.join("-") || code;
}

function createJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureTempRoot() {
  await fs.ensureDir(TEMP_ROOT);
}

async function buildPackedSession(sessionDir) {
  const files = await fs.readdir(sessionDir);
  const packed = {
    creds: {},
    keys: {}
  };

  for (const file of files) {
    if (!file.endsWith(".json")) continue;

    const fullPath = path.join(sessionDir, file);
    const content = await fs.readJson(fullPath);

    if (file === "creds.json") {
      packed.creds = content;
    } else {
      const keyName = file.replace(/\.json$/i, "");
      packed.keys[keyName] = content;
    }
  }

  return `${SESSION_PREFIX}${Buffer.from(
    JSON.stringify(packed),
    "utf-8"
  ).toString("base64")}`;
}

async function cleanupJob(jobId, delayMs = 60000) {
  const job = jobs.get(jobId);
  if (!job) return;

  setTimeout(async () => {
    try {
      if (job.socket?.ws?.readyState === 1) {
        await job.socket.logout().catch(() => {});
      }

      if (job.sessionDir) {
        await fs.remove(job.sessionDir).catch(() => {});
      }

      jobs.delete(jobId);
    } catch (error) {
      console.error("Cleanup error:", error.message);
    }
  }, delayMs);
}

async function sendSessionToInbox(sock, number, sessionString) {
  const jid = `${number}@s.whatsapp.net`;

  const sessionMessage = [
    `╭━━━〔 ${GENERATOR_NAME} 〕━━━╮`,
    "│ ✅ Session Generated",
    "│",
    "│ Your session is ready.",
    "│ Paste it into Heroku Config Vars.",
    "╰━━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    "*SESSION_ID:*",
    sessionString
  ].join("\n");

  const supportMessage = [
    "🤖 *Lite-Ollver-MD Support*",
    "",
    `👥 Support Group: ${SUPPORT_GROUP}`,
    `👑 Owner Contact: ${OWNER_CONTACT}`,
    "",
    "Your session has been delivered successfully."
  ].join("\n");

  await sock.sendMessage(jid, { text: sessionMessage });
  await sock.sendMessage(jid, { text: supportMessage });
}

async function startPairing(number, jobId) {
  await ensureTempRoot();

  const formattedNumber = cleanNumber(number);
  const sessionDir = path.join(TEMP_ROOT, jobId);
  await fs.ensureDir(sessionDir);

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.macOS("Chrome"),
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  const job = {
    id: jobId,
    number: formattedNumber,
    sessionDir,
    socket: sock,
    status: "starting",
    pairingCode: null,
    createdAt: new Date().toISOString(),
    delivered: false,
    error: null,
    pairingRequested: false
  };

  jobs.set(jobId, job);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    const current = jobs.get(jobId);

    if (!current) return;

    if (connection === "connecting") {
      current.status = "connecting";
    }

    try {
      if (qr && !current.pairingRequested) {
        current.pairingRequested = true;
        current.status = "requesting_pairing_code";

        const code = await sock.requestPairingCode(formattedNumber);
        current.pairingCode = formatPairCode(code);
        current.status = "pairing_code_ready";
      }
    } catch (error) {
      current.status = "error";
      current.error = `Failed to generate pairing code: ${error.message}`;
    }

    if (connection === "open") {
      try {
        current.status = "connected";

        const sessionString = await buildPackedSession(sessionDir);
        await sendSessionToInbox(sock, formattedNumber, sessionString);

        current.status = "delivered";
        current.delivered = true;

        await cleanupJob(jobId, 45000);
      } catch (error) {
        current.status = "error";
        current.error = error.message;
      }
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      if (!current.delivered) {
        current.status = "closed";

        if (statusCode === DisconnectReason.loggedOut) {
          current.error = "Session logged out before delivery.";
        } else if (!current.error) {
          current.error = "Connection closed before session delivery.";
        }
      }
    }
  });
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/deploy", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "deploy.html"));
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: GENERATOR_NAME,
    prefix: SESSION_PREFIX
  });
});

app.post("/api/pair", async (req, res) => {
  try {
    const number = cleanNumber(req.body.number || "");

    if (!number || number.length < 10) {
      return res.status(400).json({
        ok: false,
        message: "Enter a valid WhatsApp number."
      });
    }

    const jobId = createJobId();
    await startPairing(number, jobId);

    return res.json({
      ok: true,
      jobId,
      message: "Pairing process started."
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || "Failed to start pairing process."
    });
  }
});

app.get("/api/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({
      ok: false,
      message: "Pairing job not found or already cleaned up."
    });
  }

  return res.json({
    ok: true,
    jobId: job.id,
    number: job.number,
    status: job.status,
    pairingCode: job.pairingCode,
    delivered: job.delivered,
    error: job.error
  });
});

app.listen(PORT, async () => {
  await ensureTempRoot();
  console.log(`🌐 ${GENERATOR_NAME} running on port ${PORT}`);
});