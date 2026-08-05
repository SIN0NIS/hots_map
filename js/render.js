/* ================= 렌더링 =================
   층 구성
     #bgimg  배경 지도 — 원본 SVG 를 그대로 얹는다. 캔버스에 구워 넣으면
             캔버스 해상도가 화질 상한이 되어 확대할수록 뭉개진다.
     #dc     판서 — 지도에 붙어 있어야 하므로 월드 좌표계(#world 안).
     #objs   핀·토큰 — 마찬가지로 월드 좌표계.
     #cv     리플레이 표기(구조물·이벤트·영웅) — #world 밖의 «화면 해상도»
             오버레이다. 확대해도 아이콘이 화면 픽셀 그대로 또렷하다.
   줌·팬은 #world 의 CSS transform 이 처리하고, #cv 는 매 프레임 화면 좌표로 다시 그린다. */
let G = null;
let tCur = 0, playing = false, speed = 4, lastTs = 0;
let bgImg = null, bgAlpha = 0.7, showStruct = true, showHeroIcons = true;
let cal = null;
const R = 2;                     // 월드 좌표계 기준 배율 (예전 캔버스 배율을 그대로 씀)

const stage=document.getElementById('stage'), world=document.getElementById('world');
const bgEl=document.getElementById('bgimg');
const cv=document.getElementById('cv'), ctx=cv.getContext('2d');
const dc=document.getElementById('dc'), dctx=dc.getContext('2d');
const objsEl=document.getElementById('objs');
let CW=1600, CH=1350;
let DPR=1;

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
  dc.width=CW; dc.height=CH; dc.style.width=CW+'px'; dc.style.height=CH+'px';
  dctx.lineCap='round'; dctx.lineJoin='round';
  world.style.width=CW+'px'; world.style.height=CH+'px';
  placeBg(); resizeOverlay(); replayStrokes();
}
/* 화면 해상도 오버레이 크기 맞추기 (창 크기·패널 접힘·DPI 변화) */
function resizeOverlay(){
  DPR=Math.min(2, window.devicePixelRatio||1);
  const w=Math.max(1,stage.clientWidth), h=Math.max(1,stage.clientHeight);
  const bw=Math.round(w*DPR), bh=Math.round(h*DPR);
  if(cv.width!==bw||cv.height!==bh){ cv.width=bw; cv.height=bh; }
  markDirty();
}
/* 배경 SVG 를 월드 좌표에 맞춰 CSS 로 앉힌다 (캔버스에 굽지 않는다) */
function placeBg(){
  if(!bgImg||!cal){ bgEl.style.display='none'; return; }
  const [x1,y1]=proj(cal.L,cal.T), [x2,y2]=proj(cal.R,cal.B);
  bgEl.style.display='block';
  bgEl.style.left=x1+'px'; bgEl.style.top=y1+'px';
  bgEl.style.width=(x2-x1)+'px'; bgEl.style.height=(y2-y1)+'px';
  bgEl.style.opacity=bgAlpha;
}
/* 월드 좌표 -> #world 안의 px */
function proj(x,y){ const B=VB;
  const sx=CW/(B.maxX-B.minX), sy=CH/(B.maxY-B.minY), s=Math.min(sx,sy);
  const ox2=(CW-(B.maxX-B.minX)*s)/2, oy2=(CH-(B.maxY-B.minY)*s)/2;
  return [ox2+(x-B.minX)*s, CH-(oy2+(y-B.minY)*s)]; }

function draw(){
  needsDraw = false;
  ctx.clearRect(0,0,cv.width,cv.height);
  // 리플레이 표기(구조물·이벤트·영웅)는 리플레이 보기에서만 얹는다
  const repView = !!G && (typeof uiMode==='undefined' || uiMode==='replay');
  if(!repView) return;                 // 맵 보기 — 배경(#bgimg)과 판서만 보인다
  // 월드 좌표 -> 오버레이 픽셀. 팬·줌을 여기서 직접 반영한다.
  const zz=(typeof z==='number'&&z>0)?z:1;
  const OX=(typeof ox==='number')?ox:0, OY=(typeof oy==='number')?oy:0;
  const S=(x,y)=>{ const p=proj(x,y); return [(p[0]*zz+OX)*DPR, (p[1]*zz+OY)*DPR]; };
  const ws=zz*DPR;                     // 지도에 붙어 커지는 것 (구조물·그리드·이벤트 링)
  const ss=DPR;                        // 화면에서 크기가 일정한 것 (영웅 표시)
  if(showStruct && G.structures){
    for(const s of G.structures){
      const [px,py]=S(s.x,s.y), dead = s.deathT<=tCur;
      const R=2*ws;
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
  ctx.strokeStyle='rgba(120,140,190,.07)'; ctx.lineWidth=DPR;
  const B=VB;
  for(let x=Math.ceil(B.minX/20)*20;x<=B.maxX;x+=20){const[a,b]=S(x,B.minY),[c,d]=S(x,B.maxY);ctx.beginPath();ctx.moveTo(a,b);ctx.lineTo(c,d);ctx.stroke();}
  for(let y=Math.ceil(B.minY/20)*20;y<=B.maxY;y+=20){const[a,b]=S(B.minX,y),[c,d]=S(B.maxX,y);ctx.beginPath();ctx.moveTo(a,b);ctx.lineTo(c,d);ctx.stroke();}
  // 최근 이벤트 링
  for(const e of G.evs){
    if(e.t>tCur||tCur-e.t>5) continue;
    const x=e.PositionX??e.x, y=e.PositionY??e.y; if(x==null) continue;
    const [px,py]=S(x,y), k=(tCur-e.t)/5;
    ctx.beginPath(); ctx.arc(px,py,(8+k*26)*2*ws,0,7);
    ctx.strokeStyle = CAT(e)==='kill' ? `rgba(255,95,109,${.8*(1-k)})` : `rgba(232,182,76,${.8*(1-k)})`;
    ctx.lineWidth=4*ws; ctx.stroke();
  }
  // 영웅 — 화면상 크기가 늘 일정하도록 ss(=DPR)만 곱한다
  for(const lab in G.heroes){
    const hh=G.heroes[lab], col = hh.team===0?'#4da3ff':'#ff5f6d';
    for(let k=8;k>=1;k--){
      const p=posAt(hh,tCur-k*0.5); if(!p||p.dead) continue;
      const [px,py]=S(p.x,p.y);
      ctx.beginPath(); ctx.arc(px,py,6*ss,0,7);
      ctx.fillStyle=col+Math.round(18-k*2).toString(16).padStart(2,'0'); ctx.fill();
    }
    const p=posAt(hh,tCur); if(!p) continue;
    const [px,py]=S(p.x,p.y);
    const img = showHeroIcons && hh.img && hh.img.complete && hh.img.naturalWidth ? hh.img : null;
    // 사망 중에는 죽은 자리에 초상화를 «회색으로» 남긴다 (부활하면 원래 색으로 돌아온다)
    if(p.dead) ctx.globalAlpha=0.45;
    if(img){
      // 미니맵 아이콘: 팀색 테두리 원 안에 초상화
      const r = 18*ss;
      ctx.save();
      ctx.beginPath(); ctx.arc(px,py,r,0,7); ctx.clip();
      if(p.dead) ctx.filter='grayscale(1) brightness(.75)';
      ctx.drawImage(img, px-r, py-r, r*2, r*2);
      ctx.restore();
      ctx.beginPath(); ctx.arc(px,py,r,0,7);
      ctx.lineWidth=4.4*ss; ctx.strokeStyle=p.dead?'#7d8aa5':col; ctx.stroke();
      ctx.beginPath(); ctx.arc(px,py,r+2.2*ss,0,7);
      ctx.lineWidth=2*ss; ctx.strokeStyle='rgba(10,14,22,.9)'; ctx.stroke();
    }else{
      ctx.beginPath(); ctx.arc(px,py,12*ss,0,7);
      ctx.fillStyle=p.dead?'#5a6577':col; ctx.fill();
      ctx.lineWidth=4*ss; ctx.strokeStyle='rgba(10,14,22,.9)'; ctx.stroke();
    }
    if(p.dead){
      // 죽었다는 것이 한눈에 보이게 회색 테두리 위에 옅은 ✕ 를 겹친다
      const r=(img?18:12)*ss;
      ctx.strokeStyle='rgba(230,236,245,.75)'; ctx.lineWidth=2.4*ss;
      ctx.beginPath();
      ctx.moveTo(px-r*.55,py-r*.55); ctx.lineTo(px+r*.55,py+r*.55);
      ctx.moveTo(px+r*.55,py-r*.55); ctx.lineTo(px-r*.55,py+r*.55);
      ctx.stroke();
      ctx.globalAlpha=1;
    }
  }
}
