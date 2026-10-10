function fmt(ms){let s=Math.ceil(Math.max(0,ms)/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return h?`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`:`${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
// Τοπικός υπολογισμός υπολοίπου από remainingMs + serverTime, ώστε να μη χρειάζονται συνεχή re-render.
let clockOffset=0;
function syncClock(state){clockOffset=state.serverTime-Date.now();}
function liveRemaining(t,state){return t.running?Math.max(0,state.serverTime+t.remainingMs-(Date.now()+clockOffset)):t.remainingMs;}
// Επίπεδο χρώματος ανά χρονόμετρο: "" (κανονικό), "warn" (κίτρινο), "danger" (κόκκινο).
function levelFor(t,ms){if(!(t.running||ms<t.durationMs||ms===0))return "";if(t.redSec>0&&ms<=t.redSec*1000)return "danger";if(t.yellowSec>0&&ms<=t.yellowSec*1000)return "warn";return "";}
