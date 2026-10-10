const express = require("express");
const http = require("http");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const { exec } = require("child_process");
const QRCode = require("qrcode");
const APP_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
require("dotenv").config({ path: path.join(APP_DIR, ".env") });
const { Server } = require("socket.io");

// Εμφανίζει σφάλμα και, αν υπάρχει κονσόλα, περιμένει Enter ώστε το παράθυρο του EXE να μην κλείσει αμέσως.
function fatal(message) {
  console.error("\n" + message + "\n");
  if (process.stdin.isTTY) {
    process.stdout.write("Πάτησε Enter για έξοδο…");
    process.stdin.resume();
    process.stdin.once("data", () => process.exit(1));
  } else {
    process.exit(1);
  }
}

const PIN = String(process.env.DASHBOARD_PIN || "");

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(APP_DIR, "data");
const DATA_FILE = path.join(DATA_DIR, "state.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

// PORT=auto (ή κενό): τυχαίο μεγάλο port (49152-65535), αποθηκεύεται στο data/port και ξαναχρησιμοποιείται.
const PORT_FILE = path.join(DATA_DIR, "port");
const validPort = n => Number.isInteger(n) && n > 0 && n < 65536;
const randomPort = () => 49152 + crypto.randomInt(65536 - 49152);
const portSetting = String(process.env.PORT || "").trim().toLowerCase();
const AUTO_PORT = portSetting === "" || portSetting === "auto";
let PORT;
if (AUTO_PORT) {
  let saved = NaN;
  try { saved = Number(fs.readFileSync(PORT_FILE, "utf8").trim()); } catch { /* δεν υπάρχει ακόμα */ }
  PORT = validPort(saved) ? saved : randomPort();
} else {
  PORT = validPort(Number(portSetting)) ? Number(portSetting) : 8080;
}
function savePort() { if (AUTO_PORT) { try { fs.writeFileSync(PORT_FILE, String(PORT), "utf8"); } catch { /* μη κρίσιμο */ } } }

if (!PIN || PIN === "ChangeThisPIN123") {
  fatal("Λείπει ή είναι ανασφαλές το DASHBOARD_PIN. Αντίγραψε το .env.example σε .env και όρισε δικό σου DASHBOARD_PIN.");
  return;
}

// Αν το SESSION_SECRET λείπει ή είναι κοντό (<24), δημιουργείται τυχαίο μία φορά και αποθηκεύεται στο data/session.secret.
function resolveSessionSecret() {
  const fromEnv = String(process.env.SESSION_SECRET || "");
  if (fromEnv.length >= 24) return fromEnv;
  const file = path.join(DATA_DIR, "session.secret");
  try {
    const saved = fs.readFileSync(file, "utf8").trim();
    if (saved.length >= 24) return saved;
  } catch { /* δεν υπάρχει ακόμα */ }
  const generated = crypto.randomBytes(32).toString("hex");
  try {
    fs.writeFileSync(file, generated, { encoding: "utf8", mode: 0o600 });
    console.log("Το SESSION_SECRET λείπει ή είναι κοντό· δημιουργήθηκε τυχαίο και αποθηκεύτηκε στο data/session.secret.");
  } catch (e) {
    console.warn("Δεν αποθηκεύτηκε το session.secret (" + e.message + "). Θα χρησιμοποιηθεί προσωρινό μυστικό μέχρι το κλείσιμο.");
  }
  return generated;
}
const SESSION_SECRET = resolveSessionSecret();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const COLORS = ["#ffffff", "#22c55e", "#ef4444", "#f59e0b", "#60a5fa"];
const MAX_MS = 24 * 60 * 60 * 1000;
// Ρυθμίσεις ανά χρονόμετρο: κίτρινο/κόκκινο όταν απομένουν <= δευτερόλεπτα (0 = απενεργοποιημένο), τοπική ώρα, γραμμή προόδου, flash στο μηδέν.
const TIMER_DEFAULTS = { yellowSec: 60, redSec: 15, showClock: false, showProgress: true, flashOnZero: true };

const defaultState = () => ({
  timers: [
    { id: crypto.randomUUID(), name: "Timer 1", durationMs: 10 * 60 * 1000, remainingMs: 10 * 60 * 1000, running: false, endAt: null, order: 0 },
    { id: crypto.randomUUID(), name: "Timer 2", durationMs: 20 * 60 * 1000, remainingMs: 20 * 60 * 1000, running: false, endAt: null, order: 1 },
    { id: crypto.randomUUID(), name: "Timer 3", durationMs: 20 * 60 * 1000, remainingMs: 20 * 60 * 1000, running: false, endAt: null, order: 2 }
  ],
  messages: [],
  settings: { activeTimerId: null, blackout: false, clockOnly: false }
});

let state;
try {
  state = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) : defaultState();
  if (!state || !Array.isArray(state.timers) || !Array.isArray(state.messages) || !state.settings) throw new Error("Invalid state");
} catch (e) {
  fatal("Δεν ήταν δυνατή η ανάγνωση του data/state.json: " + e.message);
  return;
}
// Μετάβαση από παλιότερες εκδόσεις: συμπλήρωση προεπιλογών ανά χρονόμετρο και καθαρισμός γενικών ρυθμίσεων.
for (const t of state.timers) for (const [k, v] of Object.entries(TIMER_DEFAULTS)) if (t[k] === undefined) t[k] = v;
// Νέες προεπιλογές (κίτρινο 60″, κόκκινο 15″): εφαρμόζονται μία φορά στις παλιές αυτόματες τιμές 120/30.
if (!state.defaultsV2) {
  for (const t of state.timers) if (t.yellowSec === 120 && t.redSec === 30) { t.yellowSec = 60; t.redSec = 15; }
  state.defaultsV2 = true;
}
// Το flash στο μηδέν (5″) είναι πλέον η προεπιλογή: ενεργοποιείται μία φορά στα υπάρχοντα χρονόμετρα.
if (!state.defaultsV3) {
  for (const t of state.timers) t.flashOnZero = true;
  state.defaultsV3 = true;
}
state.settings = { activeTimerId: state.settings.activeTimerId || null, blackout: state.settings.blackout === true, clockOnly: state.settings.clockOnly === true };
if (!state.timers.some(t => t.id === state.settings.activeTimerId)) state.settings.activeTimerId = state.timers[0]?.id || null;

function writeState() {
  const tmp = DATA_FILE + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) { console.error("State save failed:", e.message); }
}
let saveQueued = false;
function saveState() {
  if (saveQueued) return;
  saveQueued = true;
  setTimeout(() => { saveQueued = false; writeState(); }, 80);
}
function shutdown() { writeState(); process.exit(0); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function remaining(timer, now = Date.now()) {
  return timer.running && timer.endAt ? Math.max(0, timer.endAt - now) : Math.max(0, timer.remainingMs || 0);
}
// Οι μη-admin παίρνουν μόνο τα εμφανή μηνύματα.
function buildState(admin, now = Date.now()) {
  return {
    admin,
    timers: [...state.timers].sort((a, b) => a.order - b.order).map(t => {
      const left = remaining(t, now);
      return {
        id: t.id, name: t.name, durationMs: t.durationMs, remainingMs: left, running: t.running, order: t.order, finished: !t.running && left <= 0, expiredAt: !t.running && left <= 0 ? (t.expiredAt || null) : null,
        yellowSec: t.yellowSec, redSec: t.redSec, showClock: t.showClock, showProgress: t.showProgress, flashOnZero: t.flashOnZero
      };
    }),
    messages: (admin ? state.messages : state.messages.filter(m => m.visible)).map(m => ({ ...m })),
    settings: { ...state.settings },
    serverTime: now
  };
}
function settleExpired() {
  let changed = false;
  for (const t of state.timers) {
    if (t.running && remaining(t) <= 0) {
      t.expiredAt = t.endAt; t.running = false; t.remainingMs = 0; t.endAt = null; changed = true;
    }
  }
  if (changed) saveState();
  return changed;
}
function broadcast() {
  settleExpired();
  const now = Date.now();
  io.to("admins").emit("state", buildState(true, now));
  io.to("viewers").emit("state", buildState(false, now));
}
function adminOnly(req, res, next) {
  if (req.session && req.session.admin === true) return next();
  return res.status(401).json({ error: "Απαιτείται σύνδεση διαχειριστή." });
}
function safeText(value, max = 100) {
  return String(value ?? "").trim().slice(0, max);
}
function findTimer(id) { return state.timers.find(t => t.id === id); }
function msFromInput(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(0, Math.min(n, 24 * 60 * 60)) * 1000);
}
const digest = v => crypto.createHash("sha256").update(String(v)).digest();
const PIN_DIGEST = digest(PIN);

// Απλός περιορισμός προσπαθειών PIN ανά IP: 5 αποτυχίες → 60" αναμονή.
const loginAttempts = new Map();
function loginBlockedFor(ip) {
  const e = loginAttempts.get(ip);
  if (!e) return 0;
  if (e.until && e.until > Date.now()) return Math.ceil((e.until - Date.now()) / 1000);
  if (e.until) loginAttempts.delete(ip);
  return 0;
}
function loginFailed(ip) {
  const e = loginAttempts.get(ip) || { count: 0, until: 0 };
  e.count += 1;
  if (e.count >= 5) { e.until = Date.now() + 60 * 1000; e.count = 0; }
  loginAttempts.set(ip, e);
}

const sessionMiddleware = session({
  name: "klepsydra_admin",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "strict", secure: false, maxAge: 8 * 60 * 60 * 1000 }
});

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use(sessionMiddleware);
app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR, { index: false, maxAge: 0 }));

app.get("/", (_req, res) => res.redirect("/view"));
app.get("/admin", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "admin.html")));
app.get("/view", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "view.html")));
app.get("/live", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "view.html"))); // ίδια σελίδα με το /view (QR θεατών)
app.get("/api/session", (req, res) => res.json({ authenticated: req.session?.admin === true }));
app.post("/api/login", (req, res) => {
  const ip = req.ip;
  const wait = loginBlockedFor(ip);
  if (wait) return res.status(429).json({ error: `Πολλές αποτυχημένες προσπάθειες. Δοκίμασε ξανά σε ${wait}″.` });
  const submitted = String(req.body?.pin ?? "");
  if (!crypto.timingSafeEqual(digest(submitted), PIN_DIGEST)) {
    loginFailed(ip);
    return res.status(401).json({ error: "Λάθος PIN." });
  }
  loginAttempts.delete(ip);
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Αποτυχία σύνδεσης." });
    req.session.admin = true;
    req.session.save(e => e ? res.status(500).json({ error: "Αποτυχία αποθήκευσης συνεδρίας." }) : res.json({ ok: true }));
  });
});
app.post("/api/logout", adminOnly, (req, res) => {
  const sid = req.sessionID;
  req.session.destroy(() => {
    io.in("sid:" + sid).disconnectSockets(true);
    res.json({ ok: true });
  });
});
// Διευθύνσεις LAN του laptop (ιδιωτικά IPv4, με όνομα adapter) για το QR των θεατών.
function lanIPs() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === "IPv4" && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)) out.push({ name, address: i.address });
    }
  }
  return out.sort((a, b) => Number(b.address.startsWith("192.168.")) - Number(a.address.startsWith("192.168."))); // πρώτα τα τυπικά Wi-Fi/LAN
}
// ?ip=<διεύθυνση>: ο διαχειριστής διαλέγει ποια IP μπαίνει στο QR (μόνο από τις διευθύνσεις του laptop).
app.get("/api/join", adminOnly, async (req, res) => {
  try {
    const ips = lanIPs();
    const wanted = String(req.query.ip || "");
    const chosen = ips.find(i => i.address === wanted) || ips[0] || null;
    const host = chosen ? chosen.address : req.hostname;
    const url = `http://${host}:${PORT}/live`;
    const svg = await QRCode.toString(url, { type: "svg", margin: 2, color: { dark: "#000000", light: "#ffffff" } });
    res.json({ url, svg, ips, selected: chosen ? chosen.address : null, port: PORT });
  } catch { res.status(500).json({ error: "Αποτυχία δημιουργίας QR." }); }
});
const stateFor = req => buildState(req.session?.admin === true);
app.get("/api/state", (req, res) => res.json(stateFor(req)));

app.post("/api/timers", adminOnly, (req, res) => {
  if (state.timers.length >= 30) return res.status(400).json({ error: "Μέγιστο όριο 30 χρονομέτρων." });
  const name = safeText(req.body?.name, 60) || `Timer ${state.timers.length + 1}`;
  const durationMs = msFromInput(req.body?.seconds ?? 600);
  if (durationMs === null || durationMs < 1000) return res.status(400).json({ error: "Ο χρόνος πρέπει να είναι τουλάχιστον 1 δευτερόλεπτο." });
  const timer = { id: crypto.randomUUID(), name, durationMs, remainingMs: durationMs, running: false, endAt: null, order: state.timers.length, ...TIMER_DEFAULTS };
  state.timers.push(timer);
  if (!state.settings.activeTimerId) state.settings.activeTimerId = timer.id;
  saveState(); broadcast(); res.json(stateFor(req));
});
// Σημείωση: το /api/timers/reorder πρέπει να δηλωθεί πριν από routes με :id ώστε να μη μπερδεύεται.
app.post("/api/timers/reorder", adminOnly, (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length !== state.timers.length || new Set(ids).size !== ids.length || !ids.every(id => state.timers.some(t => t.id === id))) {
    return res.status(400).json({ error: "Μη έγκυρη σειρά." });
  }
  ids.forEach((id, i) => { findTimer(id).order = i; });
  saveState(); broadcast(); res.json(stateFor(req));
});
app.patch("/api/timers/:id", adminOnly, (req, res) => {
  const t = findTimer(req.params.id);
  if (!t) return res.status(404).json({ error: "Το χρονόμετρο δεν βρέθηκε." });
  const b = req.body || {};
  let ms = null;
  if (b.seconds !== undefined) {
    ms = msFromInput(b.seconds);
    if (ms === null || ms < 1000) return res.status(400).json({ error: "Ο χρόνος πρέπει να είναι τουλάχιστον 1 δευτερόλεπτο." });
  }
  const secs = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 86400 ? Math.round(n) : null; };
  const yellow = b.yellowSec !== undefined ? secs(b.yellowSec) : t.yellowSec;
  const red = b.redSec !== undefined ? secs(b.redSec) : t.redSec;
  if (yellow === null || red === null) return res.status(400).json({ error: "Μη έγκυρο όριο κίτρινου/κόκκινου." });
  if (yellow > 0 && red > yellow) return res.status(400).json({ error: "Το κόκκινο πρέπει να είναι ίσο ή μικρότερο από το κίτρινο." });
  if (b.name !== undefined) t.name = safeText(b.name, 60) || t.name;
  t.yellowSec = yellow; t.redSec = red;
  for (const k of ["showClock", "showProgress", "flashOnZero"]) if (typeof b[k] === "boolean") t[k] = b[k];
  if (ms !== null && ms !== t.durationMs) { t.durationMs = ms; t.remainingMs = ms; t.running = false; t.endAt = null; t.expiredAt = null; }
  saveState(); broadcast(); res.json(stateFor(req));
});
app.delete("/api/timers/:id", adminOnly, (req, res) => {
  const idx = state.timers.findIndex(t => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "Το χρονόμετρο δεν βρέθηκε." });
  state.timers.splice(idx, 1);
  [...state.timers].sort((a, b) => a.order - b.order).forEach((t, i) => { t.order = i; });
  if (state.settings.activeTimerId === req.params.id) {
    state.settings.activeTimerId = [...state.timers].sort((a, b) => a.order - b.order)[0]?.id || null;
  }
  saveState(); broadcast(); res.json(stateFor(req));
});
app.post("/api/timers/:id/action", adminOnly, (req, res) => {
  const t = findTimer(req.params.id);
  if (!t) return res.status(404).json({ error: "Το χρονόμετρο δεν βρέθηκε." });
  const action = req.body?.action;
  if (action === "start") {
    // Αν τρέχει ήδη, δεν κάνουμε τίποτα (αλλιώς θα γύριζε πίσω στην παλιά τιμή remainingMs).
    if (!t.running) {
      if (t.remainingMs <= 0) t.remainingMs = t.durationMs;
      t.endAt = Date.now() + t.remainingMs; t.running = true;
    }
    // Μόνο ένα χρονόμετρο είναι ενεργό: η έναρξη το ορίζει ως ενεργό και σταματά (παύση) τα υπόλοιπα.
    for (const o of state.timers) {
      if (o.id !== t.id && o.running) { o.remainingMs = remaining(o); o.running = false; o.endAt = null; }
    }
    state.settings.activeTimerId = t.id;
  } else if (action === "pause") {
    t.remainingMs = remaining(t); t.running = false; t.endAt = null; t.expiredAt = null;
  } else if (action === "reset") {
    t.running = false; t.endAt = null; t.remainingMs = t.durationMs;
  } else if (action === "add" || action === "subtract") {
    let secs = Number(req.body?.seconds);
    if (!Number.isFinite(secs)) secs = 60;
    const delta = Math.max(1, Math.min(24 * 3600, Math.round(secs))) * 1000;
    t.remainingMs = Math.max(0, Math.min(MAX_MS, remaining(t) + (action === "add" ? delta : -delta)));
    if (t.running) t.endAt = Date.now() + t.remainingMs;
  } else return res.status(400).json({ error: "Άγνωστη ενέργεια." });
  if (t.running || t.remainingMs > 0) t.expiredAt = null; // το overtime μετράει μόνο όσο το χρονόμετρο είναι στο μηδέν
  saveState(); broadcast(); res.json(stateFor(req));
});
app.patch("/api/settings", adminOnly, (req, res) => {
  const b = req.body || {};
  if (state.timers.some(t => t.id === b.activeTimerId)) state.settings.activeTimerId = b.activeTimerId;
  if (typeof b.blackout === "boolean") state.settings.blackout = b.blackout;
  if (typeof b.clockOnly === "boolean") state.settings.clockOnly = b.clockOnly;
  saveState(); broadcast(); res.json(stateFor(req));
});
app.post("/api/messages", adminOnly, (req, res) => {
  if (state.messages.length >= 20) return res.status(400).json({ error: "Μέγιστο όριο 20 μηνυμάτων." });
  const text = safeText(req.body?.text, 240);
  if (!text) return res.status(400).json({ error: "Γράψε ένα μήνυμα." });
  const color = COLORS.includes(req.body?.color) ? req.body.color : "#ffffff";
  state.messages.push({ id: crypto.randomUUID(), text, color, visible: req.body?.visible !== false });
  saveState(); broadcast(); res.json(stateFor(req));
});
app.patch("/api/messages/:id", adminOnly, (req, res) => {
  const m = state.messages.find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: "Το μήνυμα δεν βρέθηκε." });
  if (req.body?.text !== undefined) {
    const text = safeText(req.body.text, 240);
    if (!text) return res.status(400).json({ error: "Το μήνυμα δεν μπορεί να είναι κενό." });
    m.text = text;
  }
  if (typeof req.body?.visible === "boolean") m.visible = req.body.visible;
  if (COLORS.includes(req.body?.color)) m.color = req.body.color;
  saveState(); broadcast(); res.json(stateFor(req));
});
app.delete("/api/messages/:id", adminOnly, (req, res) => {
  state.messages = state.messages.filter(x => x.id !== req.params.id);
  saveState(); broadcast(); res.json(stateFor(req));
});

// Μη έγκυρο JSON κ.λπ.: απάντηση JSON αντί για HTML stack trace.
app.use((err, _req, res, _next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  res.status(status).json({ error: status === 500 ? "Σφάλμα διακομιστή." : "Μη έγκυρο αίτημα." });
});

// Το session του socket προέρχεται από το cookie: οι admin μπαίνουν στο room "admins" και βλέπουν και τα κρυφά μηνύματα.
io.engine.use(sessionMiddleware);
io.on("connection", socket => {
  const admin = socket.request.session?.admin === true;
  socket.join(admin ? "admins" : "viewers");
  if (admin) socket.join("sid:" + socket.request.sessionID);
  socket.emit("state", buildState(admin));
});

// Έλεγχος λήξης ανά 250ms· ο πλήρης συγχρονισμός γίνεται σε κάθε αλλαγή και ως heartbeat ανά 5″ (τα clients μετράνε τοπικά).
const expiryTimer = setInterval(() => { if (settleExpired()) broadcast(); }, 250);
const heartbeatTimer = setInterval(broadcast, 5000);

let autoRetries = 0;
function listen() { server.listen(PORT, "0.0.0.0"); }
server.on("error", err => {
  if (err.code === "EADDRINUSE" && AUTO_PORT && autoRetries++ < 20) {
    PORT = randomPort(); // το αποθηκευμένο/τυχαίο port είναι πιασμένο: δοκίμασε άλλο
    return listen();
  }
  clearInterval(expiryTimer);
  clearInterval(heartbeatTimer);
  if (err.code === "EADDRINUSE") {
    fatal(`Η θύρα ${PORT} χρησιμοποιείται ήδη από άλλο πρόγραμμα (ίσως τρέχει ήδη το Klepsydra Timer).
Κλείσε το άλλο πρόγραμμα ή άλλαξε το PORT στο αρχείο .env και ξαναδοκίμασε.`);
  } else if (err.code === "EACCES") {
    fatal(`Δεν επιτρέπεται η χρήση της θύρας ${PORT}. Δοκίμασε άλλο PORT στο αρχείο .env.`);
  } else {
    fatal("Σφάλμα διακομιστή: " + err.message);
  }
});

server.on("listening", () => {
  savePort();
  console.log(`Klepsydra LAN Timer running on port ${PORT}`);
  console.log(`Dashboard: http://<LAPTOP-IP>:${PORT}/admin`);
  console.log(`View:      http://<LAPTOP-IP>:${PORT}/view`);
  for (const i of lanIPs()) console.log(`Θεατές (QR στο Dashboard): http://${i.address}:${PORT}/live  [${i.name}]`);
  console.log("Use only on a trusted private LAN. Configure Windows Firewall as described in README.");
  if (process.platform === "win32" && process.env.AUTO_OPEN_BROWSER !== "false") {
    setTimeout(() => exec(`start "" "http://localhost:${PORT}/admin"`), 900);
  }
});
listen();
