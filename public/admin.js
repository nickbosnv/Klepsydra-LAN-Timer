const $ = id => document.getElementById(id);
let current = null, socket = null;
let timersSig = "", messagesSig = "", editId = null;
// Πεδία διάρκειας ώρες / λεπτά / δευτερόλεπτα: getDur → σύνολο δευτερολέπτων, setDur ← σύνολο δευτερολέπτων.
for (const el of document.querySelectorAll("[data-dur]")) {
  const id = el.dataset.dur;
  el.innerHTML = [["h", "ω", 24], ["m", "λ", 1440], ["s", "δ", 86400]].map(([k, u, max]) => `<input type="number" id="${id}_${k}" min="0" max="${max}" step="1" value="0" inputmode="numeric" aria-label="${u}"><span>${u}</span>`).join("");
}
const getDur = id => Math.max(0, Math.round(["h", "m", "s"].reduce((sum, k, i) => sum + (Number($(`${id}_${k}`).value) || 0) * [3600, 60, 1][i], 0)));
function setDur(id, sec) { sec = Math.max(0, Math.round(sec)); $(`${id}_h`).value = Math.floor(sec / 3600); $(`${id}_m`).value = Math.floor(sec % 3600 / 60); $(`${id}_s`).value = sec % 60; }
setDur("newDur", 600); setDur("step", 60);
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
 return timers.length?timers.map(t=>{const id=esc(t.id),active=t.id===activeId;return `<article class="timer-card ${t.running?"running":""} ${active?"active":""}" data-id="${id}"><div><div class="row wrap"><span class="timer-name">${esc(t.name)}</span>${active?'<span class="pill on">Ενεργό</span>':""}<span class="pill">${t.running?"Σε εξέλιξη":t.finished?"Ολοκληρώθηκε":"Σε αναμονή"}</span></div><div class="timer-time" data-time="${id}"></div><div class="muted small">Αρχική διάρκεια: ${fmt(t.durationMs)}</div><div class="row wrap" style="margin-top:10px"><button data-select="${id}" ${active?"disabled":""}>Ορισμός ενεργού</button><button data-edit="${id}">⚙ Ρυθμίσεις</button><button data-order="${id}" data-dir="-1" ${t.order===0?"disabled":""}>↑</button><button data-order="${id}" data-dir="1" ${t.order===timers.length-1?"disabled":""}>↓</button></div></div><div class="timer-actions"><button class="good" data-act="${id}" data-action="${t.running?"pause":"start"}">${t.running?"Ⅱ Παύση":"▶ Έναρξη"}</button><button data-act="${id}" data-action="reset">↺ Reset</button><button data-act="${id}" data-action="subtract">−${step}</button><button data-act="${id}" data-action="add">+${step}</button><button class="danger" data-delete="${id}">Διαγραφή</button></div></article>`;}).join(""):`<div class="empty">Δεν υπάρχουν χρονόμετρα. Πρόσθεσε το πρώτο παραπάνω.</div>`;
}
function messagesMarkup(messages){
 return messages.length?messages.map(m=>`<div class="message-item"><div><div style="color:${esc(m.color)};font-weight:700;overflow-wrap:anywhere">${esc(m.text)}</div><div class="muted small">${m.visible?"Εμφανές":"Κρυφό"}</div></div><div class="row wrap"><button data-msg-toggle="${esc(m.id)}" data-visible="${!m.visible}">${m.visible?"Απόκρυψη":"Εμφάνιση"}</button><button class="danger" data-msg-delete="${esc(m.id)}">×</button></div></div>`).join(""):'<div class="empty" style="margin-top:10px">Δεν υπάρχουν μηνύματα.</div>';
}
// Re-render μόνο όταν αλλάζει η δομή· οι χρόνοι ενημερώνονται από το tick().
function render(){
 if(!current)return;
 const timers=current.timers,s=current.settings;
 $("timerCount").textContent=`${timers.length} / 30`;
 const tSig=JSON.stringify([s.activeTimerId,timers.map(t=>[t.id,t.name,t.durationMs,t.running,t.finished,t.order]),getDur("step")]);
 if(tSig!==timersSig){timersSig=tSig;$("timers").innerHTML=timersMarkup(timers,s.activeTimerId);}
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
 if(b.dataset.edit){const t=current.timers.find(x=>x.id===b.dataset.edit);if(!t)return;editId=t.id;$("sName").value=t.name;setDur("sDur",t.durationMs/1000);setDur("sYellow",t.yellowSec);setDur("sRed",t.redSec);$("sClock").checked=t.showClock;$("sProgress").checked=t.showProgress;$("sFlash").checked=t.flashOnZero;$("sError").textContent="";$("timerDlg").showModal();}
 if(b.dataset.order){const ids=current.timers.map(t=>t.id),i=ids.indexOf(b.dataset.order),j=i+Number(b.dataset.dir);if(i<0||j<0||j>=ids.length)return;[ids[i],ids[j]]=[ids[j],ids[i]];await api("/api/timers/reorder",{method:"POST",body:JSON.stringify({ids})});}
 }catch(err){alert(err.message);}
});
$("addTimer").addEventListener("submit",async e=>{e.preventDefault();try{await api("/api/timers",{method:"POST",body:JSON.stringify({name:$("newName").value,seconds:getDur("newDur")})});$("newName").value="";}catch(err){alert(err.message);}});
$("blackout").onchange=async()=>{try{await api("/api/settings",{method:"PATCH",body:JSON.stringify({blackout:$("blackout").checked})});}catch(e){alert(e.message);}};
$("clockOnly").onchange=async()=>{try{await api("/api/settings",{method:"PATCH",body:JSON.stringify({clockOnly:$("clockOnly").checked})});}catch(e){alert(e.message);}};
$("flashBtn").onclick=async()=>{const b=$("flashBtn");b.disabled=true;setTimeout(()=>{b.disabled=false;},2800);try{await api("/api/flash",{method:"POST"});}catch(e){b.disabled=false;alert(e.message);}};
$("sCancel").onclick=()=>$("timerDlg").close();
$("timerForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const t=current&&current.timers.find(x=>x.id===editId);if(!t){$("timerDlg").close();return;}
 const body={name:$("sName").value,yellowSec:getDur("sYellow"),redSec:getDur("sRed"),showClock:$("sClock").checked,showProgress:$("sProgress").checked,flashOnZero:$("sFlash").checked};
 const secs=getDur("sDur");
 if(secs*1000!==t.durationMs)body.seconds=secs; // η αλλαγή διάρκειας κάνει reset
 try{await api(`/api/timers/${t.id}`,{method:"PATCH",body:JSON.stringify(body)});$("timerDlg").close();}catch(err){$("sError").textContent=err.message;}
});
$("addMessage").addEventListener("submit",async e=>{e.preventDefault();try{await api("/api/messages",{method:"POST",body:JSON.stringify({text:$("messageText").value,color:$("messageColor").value,visible:$("messageVisible").checked})});$("messageText").value="";}catch(err){alert(err.message);}});
$("messages").addEventListener("click",async e=>{const b=e.target.closest("button");if(!b)return;try{if(b.dataset.msgToggle)await api(`/api/messages/${b.dataset.msgToggle}`,{method:"PATCH",body:JSON.stringify({visible:b.dataset.visible==="true"})});if(b.dataset.msgDelete)await api(`/api/messages/${b.dataset.msgDelete}`,{method:"DELETE"});}catch(err){alert(err.message);}});
(async()=>{try{const s=await api("/api/session");if(s.authenticated)showApp();else showLogin();}catch{showLogin();}})();
