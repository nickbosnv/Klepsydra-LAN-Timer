// Είσοδος του προγράμματος. Αν δεν υπάρχει PIN (πρώτη εκκίνηση χωρίς .env) ανοίγει σελίδα αρχικής ρύθμισης
// στον browser, δημιουργεί το .env και μετά ξεκινά κανονικά τον server (app.js) στο ίδιο port.
const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const dotenv = require("dotenv");
const { fatal, openUrl, GUI_EXE } = require("./lib/boot");

const APP_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const ENV_FILE = path.join(APP_DIR, ".env");
dotenv.config({ path: ENV_FILE });

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(APP_DIR, "data");
const PORT_FILE = path.join(DATA_DIR, "port");
const PUBLIC_DIR = path.join(__dirname, "public");
fs.mkdirSync(DATA_DIR, { recursive: true });

const pinOk = () => { const p = String(process.env.DASHBOARD_PIN || ""); return !!p && p !== "ChangeThisPIN123"; };
const validPort = n => Number.isInteger(n) && n > 0 && n < 65536;
const randomPort = () => 49152 + crypto.randomInt(65536 - 49152);
function startPort() {
  const setting = String(process.env.PORT || "").trim().toLowerCase();
  if (setting && setting !== "auto") return validPort(Number(setting)) ? Number(setting) : 8080;
  let saved = NaN;
  try { saved = Number(fs.readFileSync(PORT_FILE, "utf8").trim()); } catch { /* δεν υπάρχει ακόμα */ }
  return validPort(saved) ? saved : randomPort();
}

function quit() {
  if (process.listenerCount("SIGTERM")) process.emit("SIGTERM"); // ο server αποθηκεύει την κατάσταση και κλείνει
  else process.exit(0);
}

// Το PIN μπαίνει σε εισαγωγικά ώστε χαρακτήρες όπως # να μη διαβάζονται ως σχόλιο από το dotenv.
function writeEnv(pin) {
  let text = "";
  try { text = fs.readFileSync(ENV_FILE, "utf8"); } catch { /* νέο αρχείο */ }
  const lines = text ? text.split(/\r?\n/) : [];
  const set = (key, value) => {
    const i = lines.findIndex(l => new RegExp("^\\s*" + key + "\\s*=").test(l));
    if (i >= 0) lines[i] = `${key}=${value}`; else lines.push(`${key}=${value}`);
  };
  set("DASHBOARD_PIN", `"${pin}"`);
  if (!/^\s*SESSION_SECRET\s*=\s*\S{24,}/m.test(text)) set("SESSION_SECRET", crypto.randomBytes(24).toString("hex"));
  if (!lines.some(l => /^\s*PORT\s*=/.test(l))) set("PORT", "auto");
  fs.writeFileSync(ENV_FILE, lines.join("\n").replace(/\n*$/, "\n"), "utf8");
}

function runSetup() {
  return new Promise(resolve => {
    const web = express();
    const srv = http.createServer(web);
    let port = startPort(), tries = 0;
    // Μόνο από τον ίδιο υπολογιστή και με Host localhost, ώστε ούτε άλλη συσκευή του δικτύου ούτε ιστοσελίδα να ορίσει το PIN.
    web.use((req, res, next) => {
      const addr = req.socket.remoteAddress || "";
      const local = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
      const hostOk = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(req.headers.host || "");
      if (local && hostOk) return next();
      res.status(403).type("text").send("Η αρχική ρύθμιση γίνεται μόνο από τον ίδιο υπολογιστή (http://localhost).");
    });
    web.use(express.json({ limit: "4kb" }));
    web.use(express.static(PUBLIC_DIR, { index: false }));
    web.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "setup.html")));
    web.post("/api/setup", (req, res) => {
      const pin = typeof req.body?.pin === "string" ? req.body.pin : "";
      if (pin.length < 4 || pin.length > 64) return res.status(400).json({ error: "Το PIN πρέπει να έχει 4 έως 64 χαρακτήρες." });
      if (/["'\\`\u0000-\u001f]/.test(pin)) return res.status(400).json({ error: "Το PIN δεν επιτρέπεται να περιέχει εισαγωγικά, ανάποδη κάθετο ή αλλαγή γραμμής." });
      if (pin === "ChangeThisPIN123") return res.status(400).json({ error: "Διάλεξε δικό σου PIN." });
      try { writeEnv(pin); } catch (e) { return res.status(500).json({ error: "Δεν ήταν δυνατή η αποθήκευση του .env: " + e.message }); }
      dotenv.config({ path: ENV_FILE, override: true });
      process.env.DASHBOARD_PIN = pin;
      res.on("finish", () => setTimeout(() => { srv.close(() => resolve()); srv.closeAllConnections?.(); }, 150));
      res.json({ ok: true });
    });
    srv.on("error", err => {
      if (err.code === "EADDRINUSE" && tries++ < 20) { port = randomPort(); return srv.listen(port, "127.0.0.1"); }
      fatal("Δεν ήταν δυνατή η εκκίνηση της αρχικής ρύθμισης: " + err.message);
    });
    srv.on("listening", () => {
      try { fs.writeFileSync(PORT_FILE, String(port), "utf8"); } catch { /* μη κρίσιμο */ }
      console.log(`Πρώτη εκκίνηση: άνοιξε http://localhost:${port} για να ορίσεις PIN.`);
      openUrl(`http://localhost:${port}/`);
    });
    srv.listen(port, "127.0.0.1");
  });
}

(async () => {
  if (GUI_EXE || process.env.KLEPSYDRA_TRAY === "1") {
    require("./lib/tray").startTray({ portFile: PORT_FILE, onQuit: quit });
  }
  if (!pinOk()) await runSetup();
  require("./app.js");
})();
