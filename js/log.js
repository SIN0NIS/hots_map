/* ================= 이벤트 로그 =================
   재생 중에는 새로 생긴 줄만 덧붙인다. 예전에는 이벤트가 하나 뜰 때마다
   250줄(아이콘 <img> 포함)을 통째로 다시 만들어 그 프레임이 툭 걸렸다.
   logCount=-1 은 «처음부터 다시 그려라» 신호다 (되감기·필터 변경·리플레이 교체). */
const logEl=document.getElementById('log');
const filters={kill:true,struct:true,merc:true,obj:true,grow:false,misc:true};
let logCount=-1;
const LOG_MAX=250;              // 화면에 유지할 최대 줄 수

let flt=[];                     // 필터를 통과한 이벤트 (시간순)
let firstShown=0, shown=0;      // 화면에 올라간 구간 [firstShown, shown)

function evRow(e){
  const d=document.createElement('div');
  d.className='ev';
  d.innerHTML=evHTML(e,G.players);
  return d;
}
function logRebuild(){
  flt=G.evs.filter(e=>filters[CAT(e)]??true);
  let end=0; while(end<flt.length && flt[end].t<=tCur) end++;
  const start=Math.max(0,end-LOG_MAX);
  firstShown=start; shown=end;
  if(end===0){ logEl.innerHTML='<div class="empty">재생하면 이벤트가 여기에 표시됩니다</div>'; return; }
  const frag=document.createDocumentFragment();
  for(let i=start;i<end;i++) frag.appendChild(evRow(flt[i]));
  logEl.replaceChildren(frag);
  logEl.scrollTop=logEl.scrollHeight;
}
function renderLog(){
  if(!G) return;
  if(logCount===-1){ logRebuild(); logCount=shown; }
  else {
    // 되감기: 지금 시각보다 뒤에 있는 줄을 끝에서 걷어낸다.
    // 화면에 남은 것보다 더 뒤로 가면 통째로 다시 그린다.
    if(shown>firstShown && flt[firstShown].t>tCur){ logRebuild(); logCount=shown; }
    else {
      let changed=false;
      while(shown>firstShown && flt[shown-1].t>tCur){
        logEl.lastElementChild.remove(); shown--; changed=true;
      }
      // 앞으로 가기: 새로 보이게 된 것만 덧붙인다
      while(shown<flt.length && flt[shown].t<=tCur){
        if(!shown && logEl.firstElementChild?.className==='empty') logEl.replaceChildren();
        logEl.appendChild(evRow(flt[shown])); shown++; changed=true;
        if(shown-firstShown>LOG_MAX){ logEl.firstElementChild.remove(); firstShown++; }
      }
      if(changed){ logCount=shown; logEl.scrollTop=logEl.scrollHeight;
        if(shown===0&&!logEl.firstElementChild)
          logEl.innerHTML='<div class="empty">재생하면 이벤트가 여기에 표시됩니다</div>'; }
    }
  }
  // 최근 2초 강조는 «끝쪽 연속 구간» 이라, 끝에서부터 오래된 줄을 만나면 멈춘다
  const kids=logEl.children;
  for(let n=kids.length-1;n>=0;n--){
    const e=flt[firstShown+n]; if(!e) break;
    const fr=tCur-e.t<2;
    const had=kids[n].classList.contains('fresh');
    if(fr!==had) kids[n].classList.toggle('fresh',fr);
    if(!fr) break;
  }
}
document.querySelectorAll('#filters button').forEach(b=>b.onclick=()=>{
  filters[b.dataset.f]=!filters[b.dataset.f]; b.classList.toggle('on'); logCount=-1; markDirty(); });

/* 로그 패널 접기/펴기 */
const sideEl=document.getElementById('side'), sideTgl=document.getElementById('sideTgl');
sideTgl.onclick=()=>{
  const c=sideEl.classList.toggle('collapsed');
  sideTgl.textContent=c?'◂':'▸';
  sideTgl.title=c?'로그 펴기':'로그 접기';
  requestAnimationFrame(()=>{ resizeOverlay(); fit(); if(typeof drawXp==='function') drawXp(); });
};
