const $=id=>document.getElementById(id);let state=null,lastHtml=null;
const socket=io();socket.on("connect",()=>{$("connection").textContent="Live";});socket.on("disconnect",()=>{$("connection").textContent="Επανασύνδεση…";});socket.on("state",s=>{state=s;syncClock(s);render();});
// Πλήρης οθόνη + προσπάθεια κλειδώματος σε οριζόντιο προσανατολισμό (tablet)· αλλιώς η σελίδα προσαρμόζεται σε κάθε προσανατολισμό.
const root=document.documentElement;
$("fullscreen").onclick=async()=>{
 if(!(root.requestFullscreen||root.webkitRequestFullscreen)){alert("Αυτός ο browser δεν υποστηρίζει πλήρη οθόνη. Σε iPhone/iPad διάλεξε Κοινοποίηση → «Προσθήκη στην αρχική οθόνη».");return;}
 try{
 if(document.fullscreenElement||document.webkitFullscreenElement){(document.exitFullscreen||document.webkitExitFullscreen).call(document);try{screen.orientation.unlock();}catch{}}
 else{await (root.requestFullscreen||root.webkitRequestFullscreen).call(root);try{await screen.orientation.lock("landscape");}catch{}}
}catch{}};
// Εμφανίζεται πάντα το ενεργό χρονόμετρο + τα εμφανή μηνύματα. Το markup δεν περιέχει χρόνους· τους ενημερώνει το tick().
function activeTimer(){return state.timers.find(x=>x.id===state.settings.activeTimerId)||state.timers[0];}
function render(){
 if(!state)return;const t=activeTimer();
 document.body.classList.toggle("blackout",!!state.settings.blackout);
 const msgs=state.messages.filter(m=>m.visible);
 let html="";
 if(!state.settings.blackout){
  const zr=t?Math.min(100,t.redSec*1000/t.durationMs*100):0,zy=t?Math.min(100,t.yellowSec*1000/t.durationMs*100):0;
  html=state.settings.clockOnly?'<section class="hero-timer"><div class="hero-time clock-big" data-clock></div></section>':t?`<section class="hero-timer" data-tid="${esc(t.id)}">${t.speaker?`<div class="hero-speaker">${esc(t.speaker)}</div><div class="hero-title">${esc(t.name)}</div>`:`<div class="hero-name">${esc(t.name)}</div>`}<div class="hero-time" data-time></div>${t.showProgress?`<div class="progress" style="--r:${zr}%;--y:${zy}%"><div data-bar></div></div>`:""}</section>`:'<div class="empty">Δεν υπάρχει χρονόμετρο.</div>';
  if(msgs.length)html+=`<div class="view-messages">${msgs.map(m=>`<div class="view-message" style="color:${esc(m.color)}">${esc(m.text)}</div>`).join("")}</div>`;
 }
 if(html!==lastHtml){$("main").innerHTML=html;lastHtml=html;}
 $("main").classList.toggle("has-msg",!state.settings.blackout&&msgs.length>0);
 $("clock").hidden=state.settings.clockOnly||!(state.settings.showClock||(t&&t.showClock));
 tick();
}
function tick(){
 if(!state)return;const t=activeTimer();
 const big=document.querySelector("[data-clock]");if(big)big.textContent=new Date().toLocaleTimeString("el-GR",{hour12:false});
 if(!$("clock").hidden)$("clock").textContent=new Date().toLocaleTimeString("el-GR",{hour12:false});
 if(!t)return;
 const el=document.querySelector("[data-tid]");$("water").hidden=!el||!t.showProgress;if(!el)return;
 const ms=liveRemaining(t,state),ov=ms===0?overtimeMs(t,state):-1,time=el.querySelector("[data-time]"),txt=ov>=1000?fmtOver(ov):fmt(ms);if(time.textContent!==txt)time.textContent=txt;
 const bar=el.querySelector("[data-bar]");if(bar)bar.style.width=(100-(t.durationMs?Math.max(0,Math.min(100,ms/t.durationMs*100)):0))+"%";
 const lv=ov>=0?"danger":levelFor(t,ms);el.classList.toggle("lv-warn",lv==="warn");el.classList.toggle("lv-danger",lv==="danger");
 // Flash 5″ στο μηδέν: ο παλμός ξεκινά από τη σωστή φάση ακόμη κι αν η σελίδα φορτώσει στη μέση.
 const a=$("alert"),on=!!t.flashOnZero&&ov>=0&&ov<5000;
 if(on&&!a.classList.contains("loop")){a.style.setProperty("--dl",-ov+"ms");a.classList.add("loop");}else if(!on&&a.classList.contains("loop"))a.classList.remove("loop");
 // Στάθμη νερού: κατεβαίνει με τον χρόνο, παίρνει το χρώμα του επιπέδου (νερό → κίτρινο → κόκκινο)· στην υπέρβαση γεμίζει κόκκινο.
 const w=$("water");w.style.setProperty("--h",(ov>=0?100:(t.durationMs?Math.max(0,Math.min(100,ms/t.durationMs*100)):0))+"%");
 w.style.setProperty("--wc",lv==="danger"||ov>=0?"239,68,68":lv==="warn"?"250,204,21":"70,182,198");
}
setInterval(tick,250);
// Κουμπί «Flash ×3» του Dashboard: τρεις παλμοί στην οθόνη.
socket.on("flash",()=>{const a=$("alert");a.classList.remove("burst");void a.offsetWidth;a.classList.add("burst");});
$("alert").addEventListener("animationend",e=>{if(e.target.classList.contains("burst"))e.target.classList.remove("burst");});

// Να μένει ανοιχτή η οθόνη (tablet): 1) Screen Wake Lock API (χρειάζεται HTTPS ή localhost)· 2) αλλιώς κρυφό βίντεο σε επανάληψη,
// που κρατά την οθόνη αναμμένη και σε απλό http://192.168.x.x. Ξεκινά με το πρώτο άγγιγμα (οι browsers δεν το επιτρέπουν χωρίς κίνηση του χρήστη).
let wakeLock = null, awakeVideo = null, awakeOn = false, awakeTried = false;
const awakeStore = { get() { try { return localStorage.getItem("klepsydraAwake"); } catch { return null; } }, set(v) { try { localStorage.setItem("klepsydraAwake", v); } catch { /* χωρίς αποθήκευση */ } } };
function awakeUi() { const b = $("awake"); b.classList.toggle("on", awakeOn); b.setAttribute("aria-pressed", String(awakeOn)); b.textContent = awakeOn ? "☀ Οθόνη πάντα αναμμένη" : "☀ Να μένει αναμμένη η οθόνη"; }
// Μικρό βίντεο ~1″ που φτιάχνει ο ίδιος ο browser (mp4 στο Safari, webm στο Chrome), ώστε να παίζει παντού.
function recordClip() {
  return new Promise(resolve => {
    try {
      const c = document.createElement("canvas"); c.width = c.height = 16;
      const g = c.getContext("2d"), type = window.MediaRecorder && ["video/mp4", "video/webm;codecs=vp8", "video/webm"].find(t => MediaRecorder.isTypeSupported(t));
      if (!type || !c.captureStream) return resolve(null);
      const rec = new MediaRecorder(c.captureStream(10), { mimeType: type }), chunks = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => resolve(chunks.length ? new Blob(chunks, { type }) : null);
      rec.onerror = () => resolve(null);
      rec.start();
      let n = 0;
      const iv = setInterval(() => { g.fillStyle = n++ % 2 ? "#000" : "#020202"; g.fillRect(0, 0, 16, 16); if (n > 14) { clearInterval(iv); rec.stop(); } }, 80);
    } catch { resolve(null); }
  });
}
async function startVideo() {
  if (awakeVideo) { try { await awakeVideo.play(); return true; } catch { return false; } }
  const v = document.createElement("video");
  v.setAttribute("playsinline", ""); v.muted = true; v.loop = true; v.setAttribute("aria-hidden", "true");
  v.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:.02;pointer-events:none;z-index:-1";
  const blob = await recordClip();
  if (blob) v.src = URL.createObjectURL(blob);
  else { // χωρίς MediaRecorder: ζωντανή ροή από canvas
    const c = document.createElement("canvas"); c.width = c.height = 16;
    if (!c.captureStream) return false;
    const g = c.getContext("2d"); let n = 0; setInterval(() => { g.fillStyle = n++ % 2 ? "#000" : "#020202"; g.fillRect(0, 0, 16, 16); }, 500);
    v.srcObject = c.captureStream(5);
  }
  document.body.appendChild(v);
  try { await v.play(); awakeVideo = v; return true; } catch { v.remove(); return false; }
}
async function enableAwake() {
  let ok = false;
  if (navigator.wakeLock) {
    try { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); ok = true; } catch { /* π.χ. χαμηλή μπαταρία */ }
  }
  if (!ok) ok = await startVideo();
  awakeOn = ok; awakeUi();
  return ok;
}
function disableAwake() {
  awakeOn = false;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  if (awakeVideo) awakeVideo.pause();
  awakeUi();
}
$("awake").onclick = async () => {
  if (awakeOn) { awakeStore.set("0"); disableAwake(); } else { awakeStore.set("1"); await enableAwake(); }
};
// Το πρώτο άγγιγμα οπουδήποτε ενεργοποιεί την παραμονή (εκτός αν ο χρήστης την έχει κλείσει).
addEventListener("pointerdown", () => { if (!awakeTried && awakeStore.get() !== "0") { awakeTried = true; enableAwake(); } }, { once: false });
// Το wake lock χάνεται όταν η σελίδα κρυφτεί (π.χ. αλλαγή εφαρμογής)· επανασύνδεση όταν ξαναφανεί.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !awakeOn) return;
  if (awakeVideo && awakeVideo.paused) awakeVideo.play().catch(() => {});
  if (navigator.wakeLock && !wakeLock && !awakeVideo) enableAwake();
});
awakeUi();
