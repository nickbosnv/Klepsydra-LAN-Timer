// Εισαγωγή προγράμματος από CSV. Η μορφή που βγάζει το prompt (/ai-prompt.txt) είναι: speaker,title,duration.
// Ο parser είναι ανεκτικός (άλλος διαχωριστής, χωρίς επικεφαλίδες, ```csv fences, διάρκειες σε διάφορες μορφές) ώστε να δουλεύει και με CSV από Excel.
function extractCsv(text) {
  let s = String(text || "").replace(/^\uFEFF/, "");
  const m = s.match(/```[a-z]*\r?\n([\s\S]*?)```/i);
  return m ? m[1] : s.replace(/```[a-z]*/gi, "");
}
function detectDelimiter(line) {
  const n = { ",": 0, ";": 0, "\t": 0 };
  let q = false;
  for (const c of line) { if (c === '"') q = !q; else if (!q && c in n) n[c]++; }
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(n).sort((a, b) => b[1] - a[1])[0][0] : ",";
}
function parseCsv(text, delim) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"' && cur === "") q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  row.push(cur); rows.push(row);
  return rows.filter(r => r.some(c => c.trim() !== ""));
}
// Διάρκεια → { sec } | { sec: null } (κενό) | { error }. Δέχεται 01:30:00, 20:00 (λεπτά:δευτ.), 20, 20', 1h 30m, 1ω 30λ, 45 λεπτά.
function parseDuration(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { sec: null };
  const fin = sec => sec >= 1 && sec <= 86400 ? { sec: Math.round(sec) } : { error: sec < 1 ? "Μηδενική διάρκεια" : "Πάνω από 24 ώρες" };
  let m;
  if ((m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/))) return fin(+m[1] * 3600 + +m[2] * 60 + +m[3]);
  if ((m = s.match(/^(\d+):(\d{1,2})$/))) return fin(+m[1] * 60 + +m[2]);
  if ((m = s.match(/^(\d+(?:[.,]\d+)?)$/))) return fin(parseFloat(m[1].replace(",", ".")) * 60);
  if ((m = s.match(/^(\d+)\s*(?:ω|ώ|h)[a-zα-ωά-ώ.]*\s*(\d+)$/i))) return fin(+m[1] * 3600 + +m[2] * 60); // 1h30 = 1 ώρα 30 λεπτά
  const re = /(\d+(?:[.,]\d+)?)\s*(ώρ[α-ωά-ώ]*|ωρ[α-ωά-ώ]*|ω|h[a-z]*|λεπτ[α-ωά-ώ]*|λ|min[a-z]*|m|[΄′'’]|δευτ[α-ωά-ώ]*|δ|sec[a-z]*|s|[″"”])/gi;
  let total = 0, any = false;
  for (const x of s.matchAll(re)) {
    any = true;
    const n = parseFloat(x[1].replace(",", ".")), u = x[2][0].toLowerCase();
    total += n * ("ωώh".includes(u) ? 3600 : "λm΄′'’".includes(u) ? 60 : 1);
  }
  if (!any || s.replace(re, "").replace(/και|and|[\s,;&]/gi, "") !== "") return { error: "Δεν αναγνωρίστηκε η διάρκεια «" + s + "»" };
  return fin(total);
}
// Επιστρέφει { rows: [{ line, speaker, title, sec|null, error }], error? }.
function parseProgram(text) {
  const body = extractCsv(text);
  if (!body.trim()) return { rows: [] };
  const first = body.split(/\r?\n/).find(l => l.trim()) || "";
  const table = parseCsv(body, detectDelimiter(first));
  if (!table.length) return { rows: [] };
  const head = table[0].map(c => c.trim().toLowerCase());
  const find = re => head.findIndex(c => re.test(c));
  // Η επικεφαλίδα αναγνωρίζεται μόνο όταν το κελί είναι ολόκληρο η λέξη (π.χ. «Duration (min)»)· αλλιώς το «Θέμα Α» μιας κανονικής γραμμής θα θεωρούνταν επικεφαλίδα.
  const tail = String.raw`(\s*[\(\[].*[\)\]])?$`;
  let iS = find(new RegExp("^(speakers?|ομιλητ[ήηέε]ς?)" + tail)), iT = find(new RegExp("^(title|talk|presentation|session|name|τίτλος|τιτλος|θέμα|θεμα|ομιλ[ιί]α|όνομα|ονομα)" + tail)), iD = find(new RegExp("^(duration|minutes|time|διάρκεια|διαρκεια|χρόνος|χρονος|λεπτά|λεπτα)" + tail));
  const hasHeader = iS >= 0 || iT >= 0 || iD >= 0;
  if (hasHeader && iT < 0) return { rows: [], error: "Δεν βρέθηκε στήλη «title» (τίτλος) στην πρώτη γραμμή." };
  if (!hasHeader) { iS = 0; iT = 1; iD = 2; }
  const rows = [];
  for (let i = hasHeader ? 1 : 0; i < table.length; i++) {
    const c = table[i], cell = k => (k >= 0 && c[k] != null ? c[k].trim() : "");
    const speaker = cell(iS), title = cell(iT);
    if (!speaker && !title) continue;
    const d = parseDuration(cell(iD));
    rows.push({ line: i + 1, speaker, title, sec: d.sec ?? null, error: d.error || "" });
  }
  return { rows };
}
if (typeof module !== "undefined") module.exports = { parseProgram, parseDuration, parseCsv };
