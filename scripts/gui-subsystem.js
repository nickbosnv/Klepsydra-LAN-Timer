// Μετατρέπει το EXE από «εφαρμογή κονσόλας» σε «εφαρμογή παραθύρων» (PE subsystem 3 → 2),
// ώστε να μην ανοίγει παράθυρο terminal. Το pkg δεν έχει σχετική επιλογή, οπότε αλλάζουν 2 bytes στην κεφαλίδα.
const fs = require("fs");
const file = process.argv[2];
if (!file) { console.error("Χρήση: node scripts/gui-subsystem.js <αρχείο.exe>"); process.exit(1); }
const fd = fs.openSync(file, "r+");
try {
  const head = Buffer.alloc(4);
  fs.readSync(fd, head, 0, 4, 0x3c);
  const pe = head.readUInt32LE(0);
  const sig = Buffer.alloc(4);
  fs.readSync(fd, sig, 0, 4, pe);
  if (sig.toString("latin1") !== "PE\0\0") throw new Error("Το αρχείο δεν είναι έγκυρο EXE των Windows.");
  const offset = pe + 24 + 68; // PE signature + COFF header + θέση του Subsystem στο Optional Header
  const sub = Buffer.alloc(2);
  fs.readSync(fd, sub, 0, 2, offset);
  const value = sub.readUInt16LE(0);
  if (value === 2) console.log("Το EXE είναι ήδη χωρίς κονσόλα.");
  else if (value === 3) { fs.writeSync(fd, Buffer.from([2, 0]), 0, 2, offset); console.log("Το EXE ρυθμίστηκε χωρίς παράθυρο κονσόλας."); }
  else throw new Error("Μη αναμενόμενο subsystem: " + value);
} finally {
  fs.closeSync(fd);
}
