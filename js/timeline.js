/* ================= 경기 전체 이벤트 타임라인 + 통계 =================
   위 줄 = 1팀, 아래 줄 = 2팀. 각자 «자기 팀이 해낸 일»을 시간축에 찍는다.
   표식을 누르면 그 시각으로 이동한다. 통계창은 팀 레벨·경험치 그래프를 그린다. */

const tlRows = [document.getElementById('tl0'), document.getElementById('tl1')];
const tlAxis = document.getElementById('tlAxis');
const tlNowEl = document.getElementById('tlNow');
const statsPanel = document.getElementById('statsPanel');

/* 이벤트를 «누가 해냈나» 기준으로 팀에 나눈다.
   킬은 죽인 쪽, 건물 파괴는 부순 쪽, 용병·오브젝트는 가져간 쪽. */
function eventTeam(e, players){
  const tm = v => v==null ? null : (Math.round(v)===1 ? 0 : 1);
  switch(CAT(e)){
    case 'kill': {
      // 죽은 사람의 반대 팀이 해낸 것
      const vt = teamOf(e.player, players);
      if(e.killers && e.killers.length) return teamOf(e.killers[0], players);
      return vt===0 ? 1 : 0;
    }
    case 'struct': {
      if(e.killers && e.killers.length) return teamOf(e.killers[0], players);
      // 리플레이는 건물을 «누가» 부쉈는지 거의 남기지 않는다 (실측: 39건 중 4건).
      // 대신 건물은 자기 팀 진영에 붙어 있으므로, 주인 팀의 «반대» 가 부순 팀이다.
      const own = structOwner(e.x, e.y);
      return own==null ? null : (own===0 ? 1 : 0);
    }
    case 'merc': return tm(e.TeamID);
    case 'obj':  return e.TeamID!=null ? tm(e.TeamID) : null;
    default: return null;
  }
}
const TL_ICON = {kill:'💀', struct:'🏰', merc:'⚔️', obj:'🪶'};
/* 건물 종류 — 리플레이 내부명을 한국어와 표식으로 바꾼다.
   타임라인에는 «포탑·요새·성채·핵» 만 찍는다 (성벽·성문·우물까지 찍으면 줄이 뒤덮인다). */
function structKind(u){
  u = String(u||'');
  if(/Core|King/.test(u))         return {ko:'핵',   ic:'👑', big:true};
  if(/TownHallL3/.test(u))        return {ko:'성채', ic:'🏯', big:true};
  if(/TownHall/.test(u))          return {ko:'요새', ic:'🏰', big:true};
  if(/CannonTower/.test(u))       return {ko:'포탑', ic:'🗼', big:true};
  if(/Moonwell/.test(u))          return {ko:'치유의 우물', ic:'💧', big:false};
  if(/Gate/.test(u))              return {ko:'성문', ic:'🚪', big:false};
  if(/Wall/.test(u))              return {ko:'성벽', ic:'🧱', big:false};
  return {ko:u.replace(/^Town/,''), ic:'🏚', big:false};
}
/* 건물 주인 팀 — 양 팀 핵의 위치를 기준으로 가까운 쪽이 주인이다.
   어느 핵이 어느 팀 것인지는 «경기 시작 시각의 팀 평균 위치» 로 정한다. */
let coreSides = null;
function buildStructSides(){
  coreSides = null;
  if(!G || !G.structures) return;
  const base=[[0,0,0],[0,0,0]];
  for(const lab in G.heroes){
    const hh=G.heroes[lab], p=posAt(hh,0); if(!p) continue;
    const i=hh.team===1?1:0; base[i][0]+=p.x; base[i][1]+=p.y; base[i][2]++;
  }
  if(!base[0][2] || !base[1][2]) return;
  const B=base.map(a=>[a[0]/a[2], a[1]/a[2]]);
  const cores=G.structures.filter(s=>/Core|King/.test(s.unit))
    .map(s=>{ const d0=Math.hypot(s.x-B[0][0],s.y-B[0][1]), d1=Math.hypot(s.x-B[1][0],s.y-B[1][1]);
              return {x:s.x, y:s.y, team:d0<=d1?0:1}; });
  // 핵이 팀마다 하나씩 잡혔을 때만 쓴다 (영원의 전쟁터처럼 핵이 여럿인 전장 대비)
  if(!cores.some(c=>c.team===0) || !cores.some(c=>c.team===1)){
    coreSides = B.map((b,i)=>({x:b[0], y:b[1], team:i}));
  } else coreSides = cores;
}
function structOwner(x,y){
  if(x==null||y==null||!coreSides||!coreSides.length) return null;
  let best=null, bd=Infinity;
  for(const c of coreSides){ const d=Math.hypot(x-c.x,y-c.y); if(d<bd){bd=d; best=c.team;} }
  return best;
}

let tlBuilt = false;
function buildTimeline(){
  tlRows.forEach(r=>r.replaceChildren());
  tlAxis.replaceChildren();
  tlBuilt = false;
  if(!G || !G.maxT) return;
  buildStructSides();
  const T = G.maxT;
  for(const e of G.evs){
    const cat = CAT(e);
    let ic = TL_ICON[cat];
    if(!ic) continue;
    if(cat==='struct'){
      const k = structKind(e.UnitType||e.unit);
      if(!k.big) continue;              // 성벽·성문·우물은 너무 많아 뺀다
      ic = k.ic;
    }
    const tm = eventTeam(e, G.players);
    if(tm!==0 && tm!==1) continue;
    const m = document.createElement('span');
    m.className = 'tlmark';
    m.textContent = ic;
    m.style.left = (e.t/T*100)+'%';
    m.dataset.t = e.t;
    m.title = fmtT(e.t)+' · '+evText(e, G.players);
    m.onclick = ev=>{ ev.stopPropagation(); seekTo(e.t); };
    tlRows[tm].appendChild(m);
  }
  // 시간 눈금 — 2분 간격 (긴 경기는 5분)
  const stepSec = T>1500 ? 300 : 120;
  for(let s=0; s<=T; s+=stepSec){
    const sp = document.createElement('span');
    sp.style.left = (s/T*100)+'%';
    sp.textContent = fmtT(s);
    tlAxis.appendChild(sp);
  }
  tlBuilt = true;
}
/* 표식 툴팁용 짧은 글 (HTML 없이) */
function evText(e, players){
  switch(CAT(e)){
    case 'kill': return (e.player||'?')+' 처치'+(e.killers&&e.killers.length?' ← '+e.killers.join(', '):'');
    case 'struct': return structKind(e.UnitType||e.unit).ko+' 파괴';
    case 'merc': return (e.CampType||'용병')+' 점령';
    default: return e.e;
  }
}
/* 트랙·눈금 아무 데나 누르면 그 시각으로 */
function tlSeekFromEvent(ev, el){
  if(!G) return;
  const r = el.getBoundingClientRect();
  seekTo(Math.max(0, Math.min(G.maxT, (ev.clientX-r.left)/r.width*G.maxT)));
}
tlRows.forEach(r=>r.onclick=ev=>tlSeekFromEvent(ev,r));
tlAxis.onclick=ev=>tlSeekFromEvent(ev,tlAxis);
function seekTo(t){ tCur=t; logCount=-1; markDirty(); }

/* 지금 시각 표시선 */
function updateTimeline(){
  if(!G || !tlBuilt) return;
  const track = tlRows[0];
  const par = document.getElementById('timeline').getBoundingClientRect();
  const tr = track.getBoundingClientRect();
  tlNowEl.style.left = (tr.left-par.left + tCur/G.maxT*tr.width)+'px';
}

/* ---------------- 시간별 경험치 그래프 ----------------
   x = 경기 시간, y = 누적 경험치. 항목을 고르면 그 출처만 본다.
   («합계» 에서는 출처별 얇은 선도 같이 깔아 구성을 한눈에 보이게 한다) */
const XP_KIND = {total:'합계', minion:'돌격병', creep:'용병',
                 hero:'영웅 처치', struct:'구조물', trickle:'시간 경과'};
const XP_SUB = ['minion','creep','hero','struct','trickle'];
const gXp = document.getElementById('gXp');
const xpKindSel = document.getElementById('xpKind');
const xpLegend = document.getElementById('xpLegend');
xpKindSel.onchange = drawXp;

function xpTotal(r){ return r.minion+r.hero+r.struct+r.creep+r.trickle; }
function xpVal(r,k){ return k==='total' ? xpTotal(r) : r[k]; }
const XP_COL={minion:'#8fa3c8', creep:'#e8b64c', hero:'#ff8a94', struct:'#b9a7e0', trickle:'#5ad19a'};

/* 그래프 한 장 그리기. 작은 그래프(#gXp)와 큰 창(#gXpBig)이 같은 코드를 쓴다. */
function drawXpOn(cvEl, opt){
  if(!cvEl) return null;
  const rows = (G && G.teamXp) || [];
  const d = Math.min(2, window.devicePixelRatio||1);
  const w = cvEl.clientWidth, h = cvEl.clientHeight;
  if(!w||!h) return null;
  if(cvEl.width!==Math.round(w*d)||cvEl.height!==Math.round(h*d)){
    cvEl.width=Math.round(w*d); cvEl.height=Math.round(h*d); }
  const c = cvEl.getContext('2d');
  c.clearRect(0,0,cvEl.width,cvEl.height);
  if(!rows.length){
    c.fillStyle='#5b667d'; c.font=(11*d)+'px sans-serif'; c.textAlign='center';
    c.fillText('경험치 기록이 없는 리플레이입니다', cvEl.width/2, cvEl.height/2);
    return null;
  }
  const kind = opt.kind || 'total';
  const big = !!opt.big;
  const maxT = G.maxT || Math.max(...rows.map(r=>r.t));
  const PAD=(big?14:6)*d, PADL=(big?52:30)*d, PADB=(big?22:6)*d;
  const W=cvEl.width-PADL-PAD, H=cvEl.height-PAD-PADB;
  let maxY = 1;
  for(const r of rows) maxY = Math.max(maxY, xpVal(r,kind));
  const X = t=>PADL + (maxT? t/maxT:0)*W;
  const Y = v=>PAD + H - (v/maxY)*H;
  // 가로 눈금 + 경험치 값
  const nTick = big?6:3;
  c.strokeStyle='rgba(120,140,190,.13)'; c.lineWidth=d;
  c.fillStyle='#5b667d'; c.font=(big?11:9)*d+'px ui-monospace,monospace'; c.textAlign='right';
  for(let i=0;i<=nTick;i++){
    const y=PAD+H*i/nTick, v=Math.round(maxY*(1-i/nTick));
    c.beginPath(); c.moveTo(PADL,y); c.lineTo(PADL+W,y); c.stroke();
    c.fillText(v>=1000?(v/1000).toFixed(big?1:0)+'k':v, PADL-3*d, y+3*d);
  }
  // 세로 눈금 (큰 창만) — 2분 간격
  if(big){
    c.textAlign='center';
    const step = maxT>1500?300:120;
    for(let s=0;s<=maxT;s+=step){
      c.beginPath(); c.moveTo(X(s),PAD); c.lineTo(X(s),PAD+H); c.stroke();
      c.fillText(fmtT(s), X(s), PAD+H+15*d);
    }
  }
  // 레벨 문턱선 — «합계» 에서만 뜻이 있다
  if(big && opt.lvLines && kind==='total' && typeof LEVEL_XP!=='undefined'){
    c.setLineDash([4*d,4*d]); c.textAlign='left';
    for(const k in LEVEL_XP){
      const v=lvXp(+k); if(v==null||v>maxY) continue;
      c.strokeStyle='rgba(232,182,76,.28)';
      c.beginPath(); c.moveTo(PADL,Y(v)); c.lineTo(PADL+W,Y(v)); c.stroke();
      c.fillStyle='rgba(232,182,76,.75)';
      c.fillText('Lv '+k, PADL+3*d, Y(v)-3*d);
    }
    c.setLineDash([]);
  }
  const COL=['#4da3ff','#ff5f6d'];
  const line=(pts,color,width,alpha)=>{
    if(pts.length<2) return;
    c.globalAlpha=alpha; c.strokeStyle=color; c.lineWidth=width; c.lineJoin='round';
    c.beginPath(); pts.forEach((p,i)=> i?c.lineTo(X(p[0]),Y(p[1])):c.moveTo(X(p[0]),Y(p[1])));
    c.stroke(); c.globalAlpha=1;
  };
  // 합계일 때는 출처별 얇은 선을 먼저 깔아 둔다.
  // 큰 창에서 «항목별 색 나누기» 를 켜면 출처마다 색을 달리해 구성을 읽게 한다.
  if(kind==='total'){
    for(const k of XP_SUB) for(const tm of [0,1])
      line(rows.filter(r=>r.team===tm).map(r=>[r.t,r[k]]),
           opt.perTeam? XP_COL[k] : COL[tm],
           (opt.perTeam?1.6:1)*d, opt.perTeam? (tm?0.5:0.95) : .28);
  }
  for(const tm of [0,1])
    line(rows.filter(r=>r.team===tm).map(r=>[r.t,xpVal(r,kind)]), COL[tm], (big?3:2.2)*d, 1);
  // 지금 시각
  c.strokeStyle='rgba(232,182,76,.9)'; c.lineWidth=(big?2:1)*d;
  c.beginPath(); c.moveTo(X(tCur),PAD); c.lineTo(X(tCur),PAD+H); c.stroke();
  return {kind};
}
/* 범례 = 현재 시각의 값 */
function xpLegendHTML(kind, withSub){
  const rows=(G&&G.teamXp)||[]; if(!rows.length) return '';
  const COL=['#4da3ff','#ff5f6d'];
  const cur=[null,null];
  for(const r of rows) if(r.t<=tCur) cur[r.team]=r;
  const n=v=>v==null?'-':Math.round(v).toLocaleString();
  let html=`<span style="color:${COL[0]}">1팀 <b>${n(cur[0]&&xpVal(cur[0],kind))}</b></span>`+
           `<span style="color:${COL[1]}">2팀 <b>${n(cur[1]&&xpVal(cur[1],kind))}</b></span>`;
  if(withSub && kind==='total' && (cur[0]||cur[1])){
    html+='<span style="width:100%;opacity:.85">'+XP_SUB.map(k=>
      `<i style="font-style:normal;color:${XP_COL[k]}">${XP_KIND[k]}</i> `+
      `<b>${n(cur[0]&&cur[0][k])}</b>:<b>${n(cur[1]&&cur[1][k])}</b>`).join(' · ')+'</span>';
  }
  return html;
}
function drawXp(){
  const kind = xpKindSel.value || 'total';
  if(drawXpOn(gXp, {kind})) xpLegend.innerHTML = xpLegendHTML(kind, true);
  else xpLegend.textContent='';
  if(xpModal && !xpModal.hidden) drawXpBig();
}
/* 그래프 위를 누르면 그 시각으로 */
function xpSeek(cvEl, ev, big){
  if(!G) return;
  const r=cvEl.getBoundingClientRect();
  const PADL=big?52:30, PADR=big?14:6;
  const W=r.width-PADL-PADR;
  seekTo(Math.max(0, Math.min(G.maxT, (ev.clientX-r.left-PADL)/W*G.maxT)));
}
gXp.onclick=ev=>xpSeek(gXp,ev,false);

/* ---------------- 크게 보기 ----------------
   작은 그래프는 118px 이라 레벨 문턱이나 항목 구성이 보이지 않는다.
   같은 그래프를 큰 창에 다시 그리고, 레벨 문턱선과 «몇 경험치에 몇 레벨» 표를 곁들인다. */
const xpModal=document.getElementById('xpModal');
const gXpBig=document.getElementById('gXpBig');
const xpKind2=document.getElementById('xpKind2');
const xpLegend2=document.getElementById('xpLegend2');
const lvTable=document.getElementById('lvTable');
const xpLvLines=document.getElementById('xpLvLines');
const xpPerTeam=document.getElementById('xpPerTeam');
xpKind2.replaceChildren(...Object.keys(XP_KIND).map(k=>{
  const o=document.createElement('option'); o.value=k; o.textContent=XP_KIND[k]; return o; }));

function drawXpBig(){
  const kind = xpKind2.value || 'total';
  drawXpOn(gXpBig, {kind, big:true, lvLines:xpLvLines.checked, perTeam:xpPerTeam.checked});
  xpLegend2.innerHTML = xpLegendHTML(kind, true);
  drawLvTable();
}
/* 레벨 문턱값 표 — «경험치를 얼마나 모아야 몇 레벨인가».
   리플레이는 30초마다 표본만 남기므로 문턱은 구간으로만 알 수 있다 (js/data_levels.js 참고). */
function drawLvTable(){
  if(typeof LEVEL_XP==='undefined'){ lvTable.textContent=''; return; }
  const rows=(G&&G.teamXp)||[];
  const cur=[null,null]; for(const r of rows) if(r.t<=tCur) cur[r.team]=r;
  const now=[cur[0]?xpTotal(cur[0]):null, cur[1]?xpTotal(cur[1]):null];
  const lvNow=[1,1]; for(const r of rows) if(r.t<=tCur) lvNow[r.team]=r.lv;
  const out=[];
  for(const k in LEVEL_XP){
    const L=+k, v=lvXp(L), rg=lvXpRange(L);
    const on = L===lvNow[0]+1 || L===lvNow[1]+1;
    out.push(`<span class="${on?'on':''}" title="표본에서 잡은 구간 ${rg[0].toLocaleString()} ~ ${rg[1].toLocaleString()} — 실제 문턱은 이 사이에 있습니다">`+
             `Lv${L} ${v.toLocaleString()}+</span>`);
  }
  const left = i=>{ if(now[i]==null) return ''; const nx=lvXp(lvNow[i]+1);
    return nx==null?'':`${i+1}팀 다음 레벨까지 약 ${Math.max(0,Math.round(nx-now[i])).toLocaleString()}`; };
  out.push(`<span class="note">문턱값은 표본 리플레이 8판에서 뽑은 <b>하한</b>입니다 `+
           `— 리플레이에 30초 간격 표본만 남아, 실제 문턱은 이 값보다 조금 위입니다 (칸에 마우스를 올리면 구간). `+
           `${left(0)} · ${left(1)}</span>`);
  lvTable.innerHTML=out.join('');
}
function openXpBig(){
  if(!G) return;
  xpKind2.value = xpKindSel.value || 'total';
  xpModal.hidden=false;
  // 창이 뜨자마자 한 번, 배치가 잡힌 다음 한 번 더 그린다.
  // (숨김을 풀기 전에는 캔버스 크기가 0 이라 첫 그림이 통째로 빈다)
  drawXpBig(); requestAnimationFrame(drawXpBig);
}
function closeXpBig(){ xpModal.hidden=true; }
document.getElementById('xpBig').onclick=openXpBig;
document.getElementById('xpClose').onclick=closeXpBig;
xpModal.onclick=e=>{ if(e.target===xpModal) closeXpBig(); };
xpKind2.onchange=drawXpBig;
xpLvLines.onchange=drawXpBig;
xpPerTeam.onchange=drawXpBig;
gXpBig.onclick=ev=>{ xpSeek(gXpBig,ev,true); drawXpBig(); };
window.addEventListener('keydown',e=>{
  if(e.target.matches('input,select,textarea')) return;
  if(e.key==='Escape'){ if(!xpModal.hidden){ closeXpBig(); e.stopPropagation(); } }
  else if((e.key==='g'||e.key==='G') && G){ xpModal.hidden?openXpBig():closeXpBig(); }
});
window.addEventListener('resize',()=>{ if(!xpModal.hidden) drawXpBig(); });
