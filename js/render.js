/* ================= 렌더링 (고정 해상도 캔버스) =================
   cv = 리플레이 화면 (배경·구조물·영웅), dc = 판서 레이어.
   줌·팬은 #world 의 CSS transform 하나로 처리하므로 캔버스는 다시 그릴 필요 없다. */
let G = null;
let tCur = 0, playing = false, speed = 4, lastTs = 0;
let bgImg = null, bgAlpha = 0.7, showStruct = true, showHeroIcons = true;
let cal = null;
const R = 2;                     // 캔버스 내부 해상도 배율 (고정)

const stage=document.getElementById('stage'), world=document.getElementById('world');
const cv=document.getElementById('cv'), ctx=cv.getContext('2d');
const dc=document.getElementById('dc'), dctx=dc.getContext('2d');
const objsEl=document.getElementById('objs');
let CW=1600, CH=1350;

/* 정지 중 불필요한 다시 그리기를 막는 신호. 화면에 영향을 주는 값이
   바뀔 때 markDirty() 를 부르면 다음 프레임에 한 번 그린다. */
let needsDraw = true;
function markDirty(){ needsDraw = true; }

/* 화면에 담는 월드 범위. 리플레이와 분리해 둔다 — 맵만 보는 상태에서도
   투영이 되어야 하고, 리플레이를 나중에 열어도 그림틀이 그대로여야
   먼저 그려둔 판서·핀이 제자리에 남는다. */
let VB = {minX:0, maxX:256, minY:0, maxY:216};
function setViewBounds(b){ VB={...b}; }

function setupCanvas(){
  const aspect=(VB.maxX-VB.minX)/(VB.maxY-VB.minY);
  CW=1800; CH=Math.round(CW/aspect);
  if(CH>2000){ CH=2000; CW=Math.round(CH*aspect); }
  for(const c of [cv,dc]){ c.width=CW; c.height=CH;
    c.style.width=CW+'px'; c.style.height=CH+'px'; }
  dctx.lineCap='round'; dctx.lineJoin='round';
  world.style.width=CW+'px'; world.style.height=CH+'px';
  replayStrokes();
}
function proj(x,y){ const B=VB;
  const sx=CW/(B.maxX-B.minX), sy=CH/(B.maxY-B.minY), s=Math.min(sx,sy);
  const ox2=(CW-(B.maxX-B.minX)*s)/2, oy2=(CH-(B.maxY-B.minY)*s)/2;
  return [ox2+(x-B.minX)*s, CH-(oy2+(y-B.minY)*s)]; }

function draw(){
  if(!G && !bgImg) return;
  needsDraw = false;
  // 영웅 표시는 화면에서 늘 같은 크기로 보이게 줌을 역보정한다.
  // (캔버스 전체가 CSS 로 z 배 확대되므로 캔버스 안에서는 1/z 로 그린다)
  const iz = 1/((typeof z==='number' && z>0) ? z : 1);
  ctx.clearRect(0,0,CW,CH);
  if(bgImg && cal){
    const [x1,y1]=proj(cal.L,cal.T), [x2,y2]=proj(cal.R,cal.B);
    ctx.globalAlpha=bgAlpha;
    ctx.drawImage(bgImg, x1, y1, x2-x1, y2-y1);
    ctx.globalAlpha=1;
  }
  if(showStruct && G && G.structures){
    for(const s of G.structures){
      const [px,py]=proj(s.x,s.y), dead = s.deathT<=tCur;
      ctx.globalAlpha = dead? .25 : .85;
      if(/Core|King/.test(s.unit)){ ctx.fillStyle='#e8b64c';
        ctx.beginPath();ctx.arc(px,py,7*R,0,7);ctx.fill();
        ctx.strokeStyle='#0e1219';ctx.lineWidth=2*R;ctx.stroke(); }
      else if(/TownHall/.test(s.unit)){ ctx.fillStyle='#b9a7e0';
        ctx.fillRect(px-5*R,py-5*R,10*R,10*R); }
      else if(/CannonTower/.test(s.unit)){ ctx.fillStyle='#8fa3c8';
        ctx.fillRect(px-2.5*R,py-2.5*R,5*R,5*R); }
      else if(/Moonwell/.test(s.unit)){ ctx.strokeStyle='#5ad19a';ctx.lineWidth=1.5*R;
        ctx.beginPath();ctx.arc(px,py,3.5*R,0,7);ctx.stroke(); }
      else if(/MercCamp/.test(s.unit)){ ctx.fillStyle='#e8b64c';
        ctx.save();ctx.translate(px,py);ctx.rotate(Math.PI/4);
        ctx.fillRect(-3*R,-3*R,6*R,6*R);ctx.restore(); }
      else { ctx.fillStyle='rgba(140,155,185,.5)';
        ctx.fillRect(px-1.5*R,py-1.5*R,3*R,3*R); }
      if(dead){ ctx.globalAlpha=.6; ctx.strokeStyle='#ff5f6d'; ctx.lineWidth=1.5*R;
        ctx.beginPath();ctx.moveTo(px-4*R,py-4*R);ctx.lineTo(px+4*R,py+4*R);
        ctx.moveTo(px+4*R,py-4*R);ctx.lineTo(px-4*R,py+4*R);ctx.stroke(); }
      ctx.globalAlpha=1;
    }
  }
  // 그리드
  ctx.strokeStyle='rgba(120,140,190,.07)'; ctx.lineWidth=1;
  const B=VB;
  for(let x=Math.ceil(B.minX/20)*20;x<=B.maxX;x+=20){const[a,b]=proj(x,B.minY),[c,d]=proj(x,B.maxY);ctx.beginPath();ctx.moveTo(a,b);ctx.lineTo(c,d);ctx.stroke();}
  for(let y=Math.ceil(B.minY/20)*20;y<=B.maxY;y+=20){const[a,b]=proj(B.minX,y),[c,d]=proj(B.maxX,y);ctx.beginPath();ctx.moveTo(a,b);ctx.lineTo(c,d);ctx.stroke();}
  if(!G) return;                       // 맵만 보는 상태 — 여기까지
  // 최근 이벤트 링
  for(const e of G.evs){
    if(e.t>tCur||tCur-e.t>5) continue;
    const x=e.PositionX??e.x, y=e.PositionY??e.y; if(x==null) continue;
    const [px,py]=proj(x,y), k=(tCur-e.t)/5;
    ctx.beginPath(); ctx.arc(px,py,(8+k*26)*R,0,7);
    ctx.strokeStyle = CAT(e)==='kill' ? `rgba(255,95,109,${.8*(1-k)})` : `rgba(232,182,76,${.8*(1-k)})`;
    ctx.lineWidth=2*R; ctx.stroke();
  }
  // 영웅 — 크기는 전부 iz 를 곱해 화면상 일정하게 유지한다
  const fs = 11*R*iz;
  ctx.textAlign='center';
  for(const lab in G.heroes){
    const hh=G.heroes[lab], col = hh.team===0?'#4da3ff':'#ff5f6d';
    for(let k=8;k>=1;k--){
      const p=posAt(hh,tCur-k*0.5); if(!p||p.dead) continue;
      const [px,py]=proj(p.x,p.y);
      ctx.beginPath(); ctx.arc(px,py,3*R*iz,0,7);
      ctx.fillStyle=col+Math.round(18-k*2).toString(16).padStart(2,'0'); ctx.fill();
    }
    const p=posAt(hh,tCur); if(!p) continue;
    const [px,py]=proj(p.x,p.y);
    if(p.dead){ ctx.fillStyle='rgba(150,160,180,.6)';
      ctx.font=`${fs}px sans-serif`; ctx.fillText('✕',px,py+fs*.35); continue; }
    const img = showHeroIcons && hh.img && hh.img.complete && hh.img.naturalWidth ? hh.img : null;
    if(img){
      // 미니맵 아이콘: 팀색 테두리 원 안에 초상화
      const r = 9*R*iz;
      ctx.save();
      ctx.beginPath(); ctx.arc(px,py,r,0,7); ctx.clip();
      ctx.drawImage(img, px-r, py-r, r*2, r*2);
      ctx.restore();
      ctx.beginPath(); ctx.arc(px,py,r,0,7);
      ctx.lineWidth=2.2*R*iz; ctx.strokeStyle=col; ctx.stroke();
      ctx.beginPath(); ctx.arc(px,py,r+1.1*R*iz,0,7);
      ctx.lineWidth=1*R*iz; ctx.strokeStyle='rgba(10,14,22,.9)'; ctx.stroke();
    }else{
      ctx.beginPath(); ctx.arc(px,py,6*R*iz,0,7);
      ctx.fillStyle=col; ctx.fill();
      ctx.lineWidth=2*R*iz; ctx.strokeStyle='rgba(10,14,22,.9)'; ctx.stroke();
    }
  }
}
