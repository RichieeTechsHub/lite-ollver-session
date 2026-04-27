const express = require("express");
const path = require("path");
const fs = require("fs-extra");
const pino = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = process.env.PORT || 3000;

const SESSION_PREFIX = process.env.SESSION_PREFIX || "LITE-OLLVER-MD:~";
const GENERATOR_NAME = process.env.GENERATOR_NAME || "Lite-Ollver-MD Session Generator";
const SUPPORT_GROUP = process.env.SUPPORT_GROUP || "https://chat.whatsapp.com/JKF3XHbmKY47IQZc7d3LB2";
const OWNER_CONTACT = process.env.OWNER_CONTACT || "https://wa.me/254740479599";

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

  const packed = {};

  for (const file of files) {
    if (!file.endsWith(".json")) continue;

    const fullPath = path.join(sessionDir, file);
    const keyName = file.replace(/\.json$/i, "");
    packed[keyName] = await fs.readJson(fullPath);
  }

  if (!packed.creds) {
    throw new Error("creds.json missing. Pairing did not complete correctly.");
  }

  return `${SESSION_PREFIX}${Buffer.from(JSON.stringify(packed), "utf-8").toString("base64")}`;
}

async function sendSessionToInbox(sock, number, sessionString) {
  const jid = `${number}@s.whatsapp.net`;

  await sock.sendMessage(jid, { text: sessionString });

  await sock.sendMessage(jid, {
    text: [
      `╭━━━〔 ${GENERATOR_NAME} 〕━━━╮`,
      "│ ✅ Session Generated Successfully",
      "│",
      "│ Copy the session above and paste it",
      "│ into Heroku Config Vars as SESSION_ID.",
      "╰━━━━━━━━━━━━━━━━━━━━━━━╯",
      "",
      `👥 Support Group: ${SUPPORT_GROUP}`,
      `👑 Owner Contact: ${OWNER_CONTACT}`,
    ].join("\n"),
  });
}

async function cleanupJob(jobId, delayMs = 45000) {
  setTimeout(async () => {
    const job = jobs.get(jobId);
    if (!job) return;

    try {
      if (job.socket?.ws?.readyState === 1) {
        await job.socket.logout().catch(() => {});
      }

      if (job.sessionDir) {
        await fs.remove(job.sessionDir).catch(() => {});
      }

      jobs.delete(jobId);
      console.log(`[${jobId}] cleanup finished`);
    } catch (error) {
      console.error(`[${jobId}] cleanup error:`, error.message);
    }
  }, delayMs);
}

async function bootSocket(job) {
  const { state, saveCreds } = await useMultiFileAuthState(job.sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    markOnlineOnConnect: false,
    syncFullHistory: true,
    emitOwnEvents: true,
    fireInitQueries: true,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
  });

  job.socket = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    const current = jobs.get(job.id);
    if (!current) return;

    const statusCode = lastDisconnect?.error?.output?.statusCode || null;

    console.log(`[${job.id}] connection.update`, {
      connection,
      hasQr: !!qr,
      statusCode,
    });

    if (connection === "connecting") {
      current.status = "connecting";
    }

    if (qr && !current.pairingRequested && !current.delivered) {
      try {
        current.pairingRequested = true;
        current.status = "requesting_pairing_code";

        const code = await sock.requestPairingCode(current.number);

        current.pairingCode = formatPairCode(code);
        current.status = "pairing_code_ready";

        console.log(`[${job.id}] pairing code ready: ${current.pairingCode}`);
      } catch (error) {
        current.status = "error";
        current.error = `Failed to generate pairing code: ${error.message}`;
      }
    }

    if (connection === "open") {
      try {
        if (current.delivered) return;

        current.status = "connected";

        await new Promise((resolve) => setTimeout(resolve, 5000));

        const sessionString = await buildPackedSession(current.sessionDir);

        await sendSessionToInbox(sock, current.number, sessionString);

        current.status = "delivered";
        current.delivered = true;

        console.log(`[${job.id}] session delivered`);
        await cleanupJob(job.id);
      } catch (error) {
        current.status = "error";
        current.error = error.message;
        console.error(`[${job.id}] delivery failed:`, error.message);
      }
    }

    if (connection === "close") {
      console.log(`[${job.id}] connection closed: ${statusCode}`);

      if (current.delivered) return;

      if (statusCode === 515 && current.restartCount < 1) {
        current.restartCount += 1;
        current.status = "restarting_after_515";

        try {
          await bootSocket(current);
        } catch (error) {
          current.status = "error";
          current.error = `Restart failed: ${error.message}`;
        }

        return;
      }

      if (statusCode === DisconnectReason.loggedOut) {
        current.status = "error";
        current.error = "Logged out before delivery.";
        return;
      }

      current.status = "closed";
      current.error = current.error || "Connection closed before delivery.";
    }
  });
}

async function startPairing(number, jobId) {
  await ensureTempRoot();

  const formattedNumber = cleanNumber(number);
  const sessionDir = path.join(TEMP_ROOT, jobId);

  await fs.ensureDir(sessionDir);

  const job = {
    id: jobId,
    number: formattedNumber,
    sessionDir,
    socket: null,
    status: "starting",
    pairingCode: null,
    createdAt: new Date().toISOString(),
    delivered: false,
    error: null,
    pairingRequested: false,
    restartCount: 0,
  };

  jobs.set(jobId, job);

  await bootSocket(job);

  return { jobId };
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
    prefix: SESSION_PREFIX,
  });
});

app.post("/api/pair", async (req, res) => {
  try {
    const number = cleanNumber(req.body.number || "");

    if (!number || number.length < 10) {
      return res.status(400).json({
        ok: false,
        message: "Enter a valid WhatsApp number.",
      });
    }

    const jobId = createJobId();
    const result = await startPairing(number, jobId);

    return res.json({
      ok: true,
      jobId: result.jobId,
      message: "Pairing process started.",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || "Failed to start pairing.",
    });
  }
});

app.get("/api/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({
      ok: false,
      message: "Pairing job not found or already cleaned up.",
    });
  }

  return res.json({
    ok: true,
    jobId: job.id,
    number: job.number,
    status: job.status,
    pairingCode: job.pairingCode,
    delivered: job.delivered,
    error: job.error,
  });
});

app.listen(PORT, async () => {
  await ensureTempRoot();
  console.log(`🌐 ${GENERATOR_NAME} running on port ${PORT}`);
});
