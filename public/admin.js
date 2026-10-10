const $ = id => document.getElementById(id);
let current = null, socket = null;
let timersSig = "", messagesSig = "", editId = null;
const selected = new Set();
let showHidden = false;
const visibleTimers = () => current.timers.filter(t => showHidden || !t.hidden);
// Πεδία διάρκειας ώρες / λεπτά / δευτερόλεπτα: getDur → σύνολο δευτερολέπτων, setDur ← σύνολο δευτερολέπτων.
for (const el of document.querySelectorAll("[data-dur]")) {
  const id = el.dataset.dur;
  el.innerHTML = [["h", "ω", 24], ["m", "λ", 1440], ["s", "δ", 86400]].map(([k, u, max]) => `<input type="number" id="${id}_${k}" min="0" max="${max}" step="1" value="0" inputmode="numeric" aria-label="${u}"><span>${u}</span>`).join("");
}
const getDur = id => Math.max(0, Math.round(["h", "m", "s"].reduce((sum, k, i) => sum + (Number($(`${id}_${k}`).value) || 0) * [3600, 60, 1][i], 0)));
function setDur(id, sec) { sec = Math.max(0, Math.round(sec)); $(`${id}_h`).value = Math.floor(sec / 3600); $(`${id}_m`).value = Math.floor(sec % 3600 / 60); $(`${id}_s`).value = sec % 60; }
setDur("newDur", 600); setDur("step", 60); setDur("impDef", 600);
function fmtStep(sec) { const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return [h && h + "ω", m && m + "′", s && s + "″"].filter(Boolean).join(" ") || "0"; }
for (const k of ["h", "m", "s"]) $(`step_${k}`).addEventListener("input", () => { timersSig = ""; render(); });
async function api(url, options={}) {
  const res = await fetch(url, { credentials:"same-origin", ...options, headers:{"Content-Type":"application/json", ...(options.headers||{})} });
  const data = await res.json().catch(()=>({}));
  if (res.status === 401 && url !== "/api/login") { showLogin(); throw new Error(data.error || "Απαιτείται σύνδεση."); }
  if (!res.ok) throw new Error(data.error || "Κάτι πήγε στραβά.");
  return data;
}
function showLogin(){
  $("login").hidden=false; $("app").hidden=true;
  if(socket){socket.disconnect();socket=null;}
  current=null; timersSig=messagesSig="";
}
function storedIp(){try{return localStorage.getItem("klepsydraJoinIp")||"";}catch{return "";}}
async function loadJoin(ip){
 try{
  const j=await api("/api/join"+(ip?`?ip=${encodeURIComponent(ip)}`:""));
  $("noIp").hidden=j.ips.length>0;$("ipWrap").hidden=j.ips.length===0;
  $("ipSelect").innerHTML=j.ips.map(i=>`<option value="${esc(i.address)}">${esc(i.address)} — ${esc(i.name)}</option>`).join("");
  if(j.selected)$("ipSelect").value=j.selected;
  $("qr").innerHTML=j.svg;$("joinUrl").textContent=j.url;
 }catch{}
}
$("ipSelect").addEventListener("change",()=>{try{localStorage.setItem("klepsydraJoinIp",$("ipSelect").value);}catch{}loadJoin($("ipSelect").value);});
function showApp(){
  $("login").hidden=true; $("app").hidden=false;
  if(socket)return;
  loadJoin(storedIp());
  socket=io();
  socket.on("connect",()=>{$("status").textContent="Συνδεδεμένο — ζωντανός συγχρονισμός";});
  socket.on("disconnect",()=>{$("status").textContent="Η σύνδεση διακόπηκε — επανασύνδεση…";});
  socket.on("state",s=>{
    if(!s.admin){showLogin();return;} // η συνεδρία έληξε
    current=s; syncClock(s); render();
  });
}
$("loginForm").addEventListener("submit",async e=>{e.preventDefault();$("loginError").textContent="";try{await api("/api/login",{method:"POST",body:JSON.stringify({pin:$("pin").value})});$("pin").value="";showApp();}catch(err){$("loginError").textContent=err.message;}});
$("logout").onclick=async()=>{try{await api("/api/logout",{method:"POST"});}catch{}showLogin();};
async function act(id,action,seconds){try{await api(`/api/timers/${id}/action`,{method:"POST",body:JSON.stringify({action,seconds})});}catch(e){alert(e.message);}}

function timersMarkup(timers,activeId){
 const step=esc(fmtStep(getDur("step")));
 return timers.length?timers.map((t,i)=>{const id=esc(t.id),active=t.id===activeId,sel=selected.has(t.id);return `<article class="timer-card ${t.running?"running":""} ${active?"active":""} ${t.hidden?"is-hidden":""} ${sel?"selected":""}" data-id="${id}"><label class="card-check"><input type="checkbox" data-sel="${id}" ${sel?"checked":""} aria-label="Επιλογή"></label><div>${t.speaker?`<div class="timer-speaker">${esc(t.speaker)}</div>`:""}<div class="row wrap"><span class="timer-name">${esc(t.name)}</span>${active?'<span class="pill on">Ενεργό</span>':""}${t.hidden?'<span class="pill">Κρυφό</span>':""}<span class="pill">${t.running?"Σε εξέλιξη":t.finished?"Ολοκληρώθηκε":"Σε αναμονή"}</span></div><div class="timer-time" data-time="${id}"></div><div class="muted small">Αρχική διάρκεια: ${fmt(t.durationMs)}</div><div class="row wrap" style="margin-top:10px"><button data-select="${id}" ${active?"disabled":""}>Ορισμός ενεργού</button><button data-edit="${id}">⚙ Ρυθμίσεις</button><button data-order="${id}" data-dir="-1" ${i===0?"disabled":""}>↑</button><button data-order="${id}" data-dir="1" ${i===timers.length-1?"disabled":""}>↓</button></div></div><div class="timer-actions"><button class="good" data-act="${id}" data-action="${t.running?"pause":"start"}">${t.running?"Ⅱ Παύση":"▶ Έναρξη"}</button><button data-act="${id}" data-action="reset">↺ Reset</button><button data-act="${id}" data-action="subtract">−${step}</button><button data-act="${id}" data-action="add">+${step}</button><button class="danger" data-delete="${id}">Διαγραφή</button></div></article>`;}).join(""):`<div class="empty">Δεν υπάρχουν ορατά χρονόμετρα. Πάτα «+ Νέο χρονόμετρο» ή «Εισαγωγή προγράμματος».</div>`;
}
function messagesMarkup(messages){
 return messages.length?messages.map(m=>`<div class="message-item"><div><div style="color:${esc(m.color)};font-weight:700;overflow-wrap:anywhere">${esc(m.text)}</div><div class="muted small">${m.visible?"Εμφανές":"Κρυφό"}</div></div><div class="row wrap"><button data-msg-toggle="${esc(m.id)}" data-visible="${!m.visible}">${m.visible?"Απόκρυψη":"Εμφάνιση"}</button><button class="danger" data-msg-delete="${esc(m.id)}">×</button></div></div>`).join(""):'<div class="empty" style="margin-top:10px">Δεν υπάρχουν μηνύματα.</div>';
}
// Re-render μόνο όταν αλλάζει η δομή· οι χρόνοι ενημερώνονται από το tick().
function render(){
 if(!current)return;
 const s=current.settings,timers=visibleTimers();
 for(const id of [...selected])if(!timers.some(t=>t.id===id))selected.delete(id);
 $("timerCount").textContent=`${current.timers.length} / 200`;
 const tSig=JSON.stringify([s.activeTimerId,timers.map(t=>[t.id,t.name,t.speaker,t.durationMs,t.running,t.finished,t.order,t.hidden]),getDur("step"),[...selected]]);
 if(tSig!==timersSig){timersSig=tSig;$("timers").innerHTML=timersMarkup(timers,s.activeTimerId);}
 updateSelBar();
 $("clockBtn").classList.toggle("on",!!s.showClock);$("clockBtn").setAttribute("aria-pressed",String(!!s.showClock));
 if(document.activeElement!==$("blackout"))$("blackout").checked=!!s.blackout;
 if(document.activeElement!==$("clockOnly"))$("clockOnly").checked=!!s.clockOnly;
 const mSig=JSON.stringify(current.messages);
 if(mSig!==messagesSig){messagesSig=mSig;$("messages").innerHTML=messagesMarkup(current.messages);}
 tick();
}
function tick(){
 if(!current)return;
 for(const el of document.querySelectorAll("[data-time]")){
  const t=current.timers.find(x=>x.id===el.dataset.time);if(!t)continue;
  const ms=liveRemaining(t,current),ov=ms===0?overtimeMs(t,current):-1,txt=ov>=1000?fmtOver(ov):fmt(ms);if(el.textContent!==txt)el.textContent=txt;
 }
}
setInterval(tick,250);

$("timers").addEventListener("click",async e=>{
 const b=e.target.closest("button");if(!b)return;
 try{
 if(b.dataset.act){const step=getDur("step");if((b.dataset.action==="add"||b.dataset.action==="subtract")&&step<1){alert("Όρισε βήμα τουλάχιστον 1 δευτερολέπτου.");return;}await act(b.dataset.act,b.dataset.action,step);}
 if(b.dataset.delete&&confirm("Να διαγραφεί το χρονόμετρο;"))await api(`/api/timers/${b.dataset.delete}`,{method:"DELETE"});
 if(b.dataset.select)await api("/api/settings",{method:"PATCH",body:JSON.stringify({activeTimerId:b.dataset.select})});
 if(b.dataset.edit){const t=current.timers.find(x=>x.id===b.dataset.edit);if(!t)return;editId=t.id;$("sSpeaker").value=t.speaker||"";$("sName").value=t.name;setDur("sDur",t.durationMs/1000);setDur("sYellow",t.yellowSec);setDur("sRed",t.redSec);$("sClock").checked=t.showClock;$("sProgress").checked=t.showProgress;$("sFlash").checked=t.flashOnZero;$("sError").textContent="";$("timerDlg").showModal();}
 if(b.dataset.order){const ids=current.timers.map(t=>t.id),vis=visibleTimers().map(t=>t.id),vi=vis.indexOf(b.dataset.order),vj=vi+Number(b.dataset.dir);if(vi<0||vj<0||vj>=vis.length)return;const i=ids.indexOf(vis[vi]),j=ids.indexOf(vis[vj]);[ids[i],ids[j]]=[ids[j],ids[i]];await api("/api/timers/reorder",{method:"POST",body:JSON.stringify({ids})});}
 }catch(err){alert(err.message);}
});
$("addTimer").addEventListener("submit",async e=>{e.preventDefault();try{await api("/api/timers",{method:"POST",body:JSON.stringify({name:$("newName").value,speaker:$("newSpeaker").value,seconds:getDur("newDur")})});$("newName").value="";$("newSpeaker").value="";$("addDlg").close();}catch(err){alert(err.message);}});
$("blackout").onchange=async()=>{try{await api("/api/settings",{method:"PATCH",body:JSON.stringify({blackout:$("blackout").checked})});}catch(e){alert(e.message);}};
$("clockOnly").onchange=async()=>{try{await api("/api/settings",{method:"PATCH",body:JSON.stringify({clockOnly:$("clockOnly").checked})});}catch(e){alert(e.message);}};
$("flashBtn").onclick=async()=>{const b=$("flashBtn");b.disabled=true;setTimeout(()=>{b.disabled=false;},2800);try{await api("/api/flash",{method:"POST"});}catch(e){b.disabled=false;alert(e.message);}};
$("clockBtn").onclick=async()=>{try{await api("/api/settings",{method:"PATCH",body:JSON.stringify({showClock:!current.settings.showClock})});}catch(e){alert(e.message);}};
$("sCancel").onclick=()=>$("timerDlg").close();
$("timerForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const t=current&&current.timers.find(x=>x.id===editId);if(!t){$("timerDlg").close();return;}
 const body={name:$("sName").value,speaker:$("sSpeaker").value,yellowSec:getDur("sYellow"),redSec:getDur("sRed"),showClock:$("sClock").checked,showProgress:$("sProgress").checked,flashOnZero:$("sFlash").checked};
 const secs=getDur("sDur");
 if(secs*1000!==t.durationMs)body.seconds=secs; // η αλλαγή διάρκειας κάνει reset
 try{await api(`/api/timers/${t.id}`,{method:"PATCH",body:JSON.stringify(body)});$("timerDlg").close();}catch(err){$("sError").textContent=err.message;}
});
$("addMessage").addEventListener("submit",async e=>{e.preventDefault();try{await api("/api/messages",{method:"POST",body:JSON.stringify({text:$("messageText").value,color:$("messageColor").value,visible:$("messageVisible").checked})});$("messageText").value="";}catch(err){alert(err.message);}});
$("messages").addEventListener("click",async e=>{const b=e.target.closest("button");if(!b)return;try{if(b.dataset.msgToggle)await api(`/api/messages/${b.dataset.msgToggle}`,{method:"PATCH",body:JSON.stringify({visible:b.dataset.visible==="true"})});if(b.dataset.msgDelete)await api(`/api/messages/${b.dataset.msgDelete}`,{method:"DELETE"});}catch(err){alert(err.message);}});
// --- Εισαγωγή προγράμματος (CSV από AI) ---
function impEval(){
 const def=getDur("impDef");
 return parseProgram($("impText").value).rows.map(r=>{
  let sec=r.sec,note=r.error,flag="";
  if(!note&&sec==null){if(def>=1){sec=def;flag="προεπιλεγμένη διάρκεια";}else note="Λείπει η διάρκεια";}
  return {...r,sec,note,flag,ok:!note};
 });
}
function impRender(){
 const parsed=parseProgram($("impText").value),rows=impEval(),ok=rows.filter(r=>r.ok);
 $("impError").textContent=parsed.error||"";
 $("impGo").disabled=!ok.length;
 $("impGo").textContent=ok.length?`Εισαγωγή ${ok.length} χρονομέτρων`:"Εισαγωγή";
 $("impPreview").innerHTML=rows.length?`<div class="muted small" style="margin-bottom:6px">${ok.length} θα εισαχθούν${rows.length>ok.length?`, ${rows.length-ok.length} θα παραλειφθούν (διόρθωσέ τες στο κείμενο παραπάνω)`:""}.</div><div class="imp-wrap"><table class="imp-table"><thead><tr><th>#</th><th>Ομιλητής</th><th>Τίτλος</th><th>Διάρκεια</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.ok?(r.flag?"imp-def":""):"imp-bad"}"><td class="num">${r.line}</td><td>${esc(r.speaker)}</td><td>${esc(r.title)}</td><td class="num">${r.sec?fmt(r.sec*1000):"—"}</td><td class="st">${esc(r.note||r.flag)}</td></tr>`).join("")}</tbody></table></div>`:"";
}
$("impOpen").onclick=()=>{impRender();$("importDlg").showModal();};
$("impCancel").onclick=()=>$("importDlg").close();
$("impText").addEventListener("input",impRender);
for(const k of ["h","m","s"])$(`impDef_${k}`).addEventListener("input",impRender);
$("impPick").onclick=()=>$("impFile").click();
$("impFile").addEventListener("change",async()=>{
 const f=$("impFile").files[0];if(!f)return;
 const buf=await f.arrayBuffer();
 let text;try{text=new TextDecoder("utf-8",{fatal:true}).decode(buf);}catch{text=new TextDecoder("windows-1253").decode(buf);} // CSV από ελληνικό Excel
 $("impText").value=text;$("impFile").value="";impRender();
});
$("impCopy").onclick=async()=>{
 const b=$("impCopy"),old=b.textContent;
 try{
  const text=await (await fetch("/ai-prompt.txt")).text();
  try{await navigator.clipboard.writeText(text);}catch{const ta=document.createElement("textarea");ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();}
  b.textContent="Αντιγράφηκε ✓";
 }catch{b.textContent="Δεν ήταν δυνατή η αντιγραφή";}
 setTimeout(()=>{b.textContent=old;},2200);
};
$("impGo").onclick=async()=>{
 const rows=impEval().filter(r=>r.ok).map(r=>({speaker:r.speaker,title:r.title,seconds:r.sec})),replace=$("impMode").value==="replace";
 if(replace&&!confirm("Θα διαγραφούν όλα τα τρέχοντα χρονόμετρα. Συνέχεια;"))return;
 try{await api("/api/timers/import",{method:"POST",body:JSON.stringify({rows,mode:replace?"replace":"add"})});$("impText").value="";$("importDlg").close();}catch(err){$("impError").textContent=err.message;}
};

// --- Διαχείριση χρονομέτρων: νέο (popup), όρια χρώματος, επόμενο, επαναφορά, μαζική επιλογή ---
function updateSelBar(){
 const n=selected.size,all=current.timers,hid=all.filter(t=>t.hidden).length,vis=visibleTimers();
 $("selCount").textContent=n?`${n} επιλεγμένα`:"Κανένα επιλεγμένο";
 for(const id of ["bulkEdit","bulkHide","bulkShow","bulkDel"])$(id).disabled=!n;
 $("selAll").checked=vis.length>0&&vis.every(t=>selected.has(t.id));
 $("hiddenCount").textContent=hid?`(${hid})`:"";
 const cur=all.findIndex(t=>t.id===current.settings.activeTimerId);
 $("nextBtn").disabled=!all.slice(cur+1).some(t=>!t.hidden);
}
async function bulk(action,patch){
 try{await api("/api/timers/bulk",{method:"POST",body:JSON.stringify({ids:[...selected],action,patch})});}catch(e){alert(e.message);return false;}
 return true;
}
$("timers").addEventListener("change",e=>{
 const id=e.target.dataset&&e.target.dataset.sel;if(!id)return;
 if(e.target.checked)selected.add(id);else selected.delete(id);
 timersSig="";render();
});
$("selAll").onchange=()=>{
 const vis=visibleTimers();
 if($("selAll").checked)vis.forEach(t=>selected.add(t.id));else vis.forEach(t=>selected.delete(t.id));
 timersSig="";render();
};
$("showHidden").onchange=()=>{showHidden=$("showHidden").checked;timersSig="";render();};
$("bulkHide").onclick=async()=>{if(await bulk("hide")){selected.clear();}};
$("bulkShow").onclick=async()=>{if(await bulk("show")){selected.clear();}};
$("bulkDel").onclick=async()=>{
 const n=selected.size;if(!n||!confirm(`Να διαγραφούν ${n} χρονόμετρα;`))return;
 if(await bulk("delete"))selected.clear();
};
$("bulkEdit").onclick=()=>{
 $("bulkTitle").textContent=`Μαζική επεξεργασία ${selected.size} χρονομέτρων`;
 for(const id of ["bulkDurOn","bulkYOn","bulkROn"])$(id).checked=false;
 for(const id of ["bulkClock","bulkProgress","bulkFlash"])$(id).value="";
 setDur("bulkDur",600);setDur("bulkY",current.settings.defaultYellowSec);setDur("bulkR",current.settings.defaultRedSec);
 $("bulkError").textContent="";$("bulkDlg").showModal();
};
// Όταν αλλάζει ένα πεδίο διάρκειας, τσεκάρεται αυτόματα το αντίστοιχο checkbox.
for(const [d,c] of [["bulkDur","bulkDurOn"],["bulkY","bulkYOn"],["bulkR","bulkROn"]])for(const k of ["h","m","s"])$(`${d}_${k}`).addEventListener("input",()=>{$(c).checked=true;});
$("bulkCancel").onclick=()=>$("bulkDlg").close();
$("bulkSave").onclick=async()=>{
 const p={};
 if($("bulkDurOn").checked)p.seconds=getDur("bulkDur");
 if($("bulkYOn").checked)p.yellowSec=getDur("bulkY");
 if($("bulkROn").checked)p.redSec=getDur("bulkR");
 for(const [id,k] of [["bulkClock","showClock"],["bulkProgress","showProgress"],["bulkFlash","flashOnZero"]])if($(id).value!=="")p[k]=$(id).value==="1";
 if(!Object.keys(p).length){$("bulkError").textContent="Διάλεξε τουλάχιστον μία αλλαγή.";return;}
 try{await api("/api/timers/bulk",{method:"POST",body:JSON.stringify({ids:[...selected],action:"update",patch:p})});$("bulkDlg").close();}catch(e){$("bulkError").textContent=e.message;}
};
$("addOpen").onclick=()=>{$("addDlg").showModal();$("newSpeaker").focus();};
$("addCancel").onclick=()=>$("addDlg").close();
$("defOpen").onclick=()=>{setDur("defY",current.settings.defaultYellowSec);setDur("defR",current.settings.defaultRedSec);$("defError").textContent="";$("defDlg").showModal();};
$("defCancel").onclick=()=>$("defDlg").close();
$("defSave").onclick=async()=>{try{await api("/api/timers/defaults",{method:"POST",body:JSON.stringify({yellowSec:getDur("defY"),redSec:getDur("defR")})});$("defDlg").close();}catch(e){$("defError").textContent=e.message;}};
$("nextBtn").onclick=async()=>{try{await api("/api/timers/next",{method:"POST"});}catch(e){alert(e.message);}};
$("resetBtn").onclick=async()=>{
 if(!confirm("Θα διαγραφούν ΟΛΑ τα χρονόμετρα και θα μείνουν μόνο τα 3 αρχικά (Timer 1, 2, 3). Συνέχεια;"))return;
 try{await api("/api/timers/reset-defaults",{method:"POST"});selected.clear();}catch(e){alert(e.message);}
};

// Οδηγία στην είσοδο: η εντολή firewall με το πραγματικό port του server.
$("fwCmd").textContent=`New-NetFirewallRule -DisplayName "Klepsydra LAN Timer" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${location.port||80} -Profile Private`;
(async()=>{try{const s=await api("/api/session");if(s.authenticated)showApp();else showLogin();}catch{showLogin();}})();
