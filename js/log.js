/* ================= 이벤트 로그 ================= */
const logEl=document.getElementById('log');
const filters={kill:true,struct:true,merc:true,obj:true,grow:false,misc:true};
let logCount=-1;
function renderLog(){
  if(!G) return;
  const vis=G.evs.filter(e=>e.t<=tCur && (filters[CAT(e)]??true));
  if(vis.length===logCount) {
    // DOM 에는 마지막 250개만 있으므로 같은 창으로 짝지어야 한다
    const w=vis.slice(-250);
    [...logEl.children].forEach((el,i)=>{ const e=w[i]; if(e) el.classList.toggle('fresh', tCur-e.t<2); });
    return; }
  logCount=vis.length;
  logEl.innerHTML = vis.length? vis.slice(-250).map(e=>
    `<div class="ev${tCur-e.t<2?' fresh':''}">${evHTML(e,G.players)}</div>`).join('')
    : '<div class="empty">재생하면 이벤트가 여기에 표시됩니다</div>';   // 리플레이는 열려 있음
  logEl.scrollTop=logEl.scrollHeight;
}
document.querySelectorAll('#filters button').forEach(b=>b.onclick=()=>{
  filters[b.dataset.f]=!filters[b.dataset.f]; b.classList.toggle('on'); logCount=-1; markDirty(); });

/* 로그 패널 접기/펴기 */
const sideEl=document.getElementById('side'), sideTgl=document.getElementById('sideTgl');
sideTgl.onclick=()=>{
  const c=sideEl.classList.toggle('collapsed');
  sideTgl.textContent=c?'◂':'▸';
  sideTgl.title=c?'로그 펴기':'로그 접기';
};
