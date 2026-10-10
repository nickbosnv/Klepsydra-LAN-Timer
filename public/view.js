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
  html=state.settings.clockOnly?'<section class="hero-timer"><div class="hero-time clock-big" data-clock></div></section>':t?`<section class="hero-timer" data-tid="${esc(t.id)}"><div class="hero-name">${esc(t.name)}</div><div class="hero-time" data-time></div>${t.showProgress?`<div class="progress" style="--r:${zr}%;--y:${zy}%"><div data-bar></div></div>`:""}</section>`:'<div class="empty">Δεν υπάρχει χρονόμετρο.</div>';
  if(msgs.length)html+=`<div class="view-messages">${msgs.map(m=>`<div class="view-message" style="color:${esc(m.color)}">${esc(m.text)}</div>`).join("")}</div>`;
 }
 if(html!==lastHtml){$("main").innerHTML=html;lastHtml=html;}
 $("clock").hidden=state.settings.clockOnly||!(t&&t.showClock);
 tick();
}
function tick(){
 if(!state)return;const t=activeTimer();
 const big=document.querySelector("[data-clock]");if(big)big.textContent=new Date().toLocaleTimeString("el-GR",{hour12:false});
 if(!t)return;
 if(t.showClock)$("clock").textContent=new Date().toLocaleTimeString("el-GR",{hour12:false});
 const el=document.querySelector("[data-tid]");if(!el)return;
 const ms=liveRemaining(t,state),time=el.querySelector("[data-time]"),txt=fmt(ms);if(time.textContent!==txt)time.textContent=txt;
 const bar=el.querySelector("[data-bar]");if(bar)bar.style.width=(100-(t.durationMs?Math.max(0,Math.min(100,ms/t.durationMs*100)):0))+"%";
 const lv=levelFor(t,ms);el.classList.toggle("lv-warn",lv==="warn");el.classList.toggle("lv-danger",lv==="danger");
 el.classList.toggle("flash",!!t.flashOnZero&&ms===0);
}
setInterval(tick,250);
