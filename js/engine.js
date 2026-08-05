/* ================= 재생 엔진 (순수 로직) =================
   리플레이 JSON -> 재생 가능한 형태(G)로 가공한다. DOM 을 만지지 않는다. */

function teamOf(playerLabel, players){
  for(const k in players){ const p=players[k];
    if(playerLabel === p.name + "(" + p.hero + ")" || playerLabel === p.name) return p.team; }
  return 0;
}

function prepare(raw){
  const players = raw.players;
  const label = {}; for(const k in players){ label[players[k].name] = players[k].name+"("+players[k].hero+")"; }
  const heroes = {};
  for(const lab in (raw.hero_position_tracks||{})){
    heroes[lab] = { team: teamOf(lab, players), pts: raw.hero_position_tracks[lab].map(p=>({t:p[0],x:p[1],y:p[2],src:p[3]})) };
  }
  for(const nm in (raw.movement_commands||{})){
    // 새 추출기는 트랙과 같은 «이름(영웅)» 라벨로 준다. 옛 JSON 은 «이름»뿐이라
    // 그때만 label 표로 옮긴다 (동명이인이면 옛 형식에서는 어차피 구분이 안 된다).
    const lab = heroes[nm] ? nm : (label[nm] || nm);
    if(!heroes[lab]) heroes[lab] = {team: teamOf(lab,players), pts:[]};
    for(const p of raw.movement_commands[nm]) heroes[lab].pts.push({t:p[0],x:p[1],y:p[2],src:'m'});
  }
  let maxT = 0, minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
  for(const lab in heroes){
    heroes[lab].pts.sort((a,b)=>a.t-b.t);
    for(const p of heroes[lab].pts){ maxT=Math.max(maxT,p.t);
      minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y); }
  }
  const evs = (raw.timeline||[]).filter(e=>!/^EndOfGame|^PlayerSpawned$/.test(e.e));
  for(const e of evs) maxT = Math.max(maxT, e.t);
  const structures = (raw.structures||[]).map(s=>({...s, deathT:Infinity}));
  for(const e of evs){
    if(e.e!=='structure_died') continue;
    let best=null,bd=9;
    for(const s of structures){ const d=Math.hypot(s.x-e.x,s.y-e.y);
      if(d<bd && s.deathT===Infinity){bd=d;best=s;} }
    if(best) best.deathT=e.t;
  }
  const out = { players, heroes, evs, maxT, structures,
    bounds:{minX:minX-6,maxX:maxX+6,minY:minY-6,maxY:maxY+6} };
  for(const lab in heroes){
    const h = heroes[lab];
    h.path = buildPath(h.pts, maxT);
    h.heroName = (lab.match(/\((.+)\)$/)||[])[1] || lab;   // 라벨 "이름(영웅)" -> 영웅
  }
  return out;
}

/* 속도제한 추적 시뮬레이션: 스냅샷 사이를 이동 명령과 최대 이속으로 메꾼다.
   원본 데이터는 1초 간격이라, 그대로 찍으면 초당 한 번씩 튄다. 여기서 촘촘한
   격자로 한 번 풀어 두고 posAt 에서 다시 보간하면 60fps 로 이어져 보인다. */
const PDT=0.1, SPEED=5.5, SNAP_DIST=10;
// 전투 스냅샷 보정 비율(스텝당). 한 번에 60% 를 당기면 그 프레임만 툭 튀므로
// 여러 스텝에 나눠 수렴시킨다. 0.25 면 스냅샷 간격(약 1초=10스텝)에 대부분 따라잡는다.
const CORR=0.25;
const F=Float32Array, U=Uint8Array;
function buildPath(pts, maxT){
  const n=Math.floor((maxT+PDT)/PDT)+1;
  const xs=new F(n), ys=new F(n), fl=new U(n);   // fl: 0=없음 1=살아있음 2=사망
  let cx=0, cy=0, has=false, tx=0, ty=0, hasT=false, dead=false, i=0;
  let sx=0, sy=0, hasS=false;                    // 수렴 중인 전투 스냅샷 목표
  // 첫 점이 한참 뒤에 있는 리플레이(난투 등)는 그 전 구간이 통째로 비어
  // 영웅이 안 그려졌다. 첫 위치를 시작부터 깔아 둔다.
  const first=pts.find(p=>p.src!=='m');
  if(first){ cx=first.x; cy=first.y; has=true; }
  for(let k=0;k<n;k++){
    const t=k*PDT;
    while(i<pts.length && pts[i].t<=t){
      const p=pts[i++];
      if(p.src==='m'){ tx=p.x; ty=p.y; hasT=true; }
      else if(p.src==='s'||p.src==='r'){ cx=p.x; cy=p.y; has=true; dead=false; hasT=false; hasS=false; }
      else if(p.src==='d'){ cx=p.x; cy=p.y; has=true; dead=true; hasT=false; hasS=false; }
      else if(p.src==='c'){
        if(!has){ cx=p.x; cy=p.y; has=true; hasS=false; }
        else if(Math.hypot(p.x-cx,p.y-cy)>SNAP_DIST){ cx=p.x; cy=p.y; hasS=false; }
        else { sx=p.x; sy=p.y; hasS=true; }      // 가까우면 부드럽게 끌어당긴다
        dead=false;
      }
    }
    if(has && !dead){
      if(hasS){                                  // 스냅샷 쪽으로 조금씩 수렴
        cx+=(sx-cx)*CORR; cy+=(sy-cy)*CORR;
        if(Math.hypot(sx-cx,sy-cy)<0.05){ cx=sx; cy=sy; hasS=false; }
      }
      if(hasT){                                  // 이동 명령 지점으로 최대 이속 이동
        const dx=tx-cx, dy=ty-cy, d=Math.hypot(dx,dy), step=SPEED*PDT;
        if(d<=step){ cx=tx; cy=ty; hasT=false; }
        else { cx+=dx/d*step; cy+=dy/d*step; }
      }
    }
    xs[k]=cx; ys[k]=cy; fl[k]=has? (dead?2:1) : 0;
  }
  return {n,xs,ys,fl};
}
/* 격자 사이를 선형 보간해 돌려준다 — 이것이 «뚝뚝 끊김»을 없애는 핵심이다. */
function posAt(h, t){
  const P=h.path; if(!P||!P.n) return null;
  const f=t/PDT;
  if(f<=0) return P.fl[0]? {x:P.xs[0],y:P.ys[0],dead:P.fl[0]===2} : null;
  const last=P.n-1;
  if(f>=last) return P.fl[last]? {x:P.xs[last],y:P.ys[last],dead:P.fl[last]===2} : null;
  const i=f|0, a=P.fl[i], b=P.fl[i+1];
  if(!a) return b? {x:P.xs[i+1],y:P.ys[i+1],dead:b===2} : null;
  // 사망 구간은 보간하지 않는다 (시체가 미끄러지면 이상하다)
  if(!b || a===2 || b===2) return {x:P.xs[i],y:P.ys[i],dead:a===2};
  const u=f-i;
  return {x:P.xs[i]+(P.xs[i+1]-P.xs[i])*u, y:P.ys[i]+(P.ys[i+1]-P.ys[i])*u, dead:false};
}

/* ---- 이벤트 분류·표기 ---- */
const CAT = e=>{
  if(e.e==='PlayerDeath')return'kill';
  if(e.e==='structure_died'||e.e==='TownStructureDeath')return'struct';
  if(e.e==='JungleCampCapture')return'merc';
  if(/Tribute|Curse|Altar|Shrine|Temple|Terror|Seed|Plant|Immortal|Punisher|Payload|Doubloon|Gem|Skull|Warhead|Cannon|Blackheart|Dragon|Garden/i.test(e.e))return'obj';
  if(e.e==='LevelUp'||e.e==='TalentChosen')return'grow';
  return 'misc';
};
const fmtT = s=>String(Math.floor(s/60)).padStart(2,'0')+":"+String(Math.floor(s%60)).padStart(2,'0');
function span(txt, team){ const c=team===0?'b':team===1?'r':'g'; return `<b class="${c}">${txt}</b>`; }
/* "이름(영웅)" 라벨 -> 영웅 아이콘을 붙인 색 라벨 */
function nameHTML(label, players){
  const t=teamOf(label,players);
  const hero=(String(label||'').match(/\((.+)\)$/)||[])[1];
  const hd=hero?heroByName(hero):null;
  const ic=hd?`<img class="li" src="icons/${hd.icon}" alt="">`:'';
  return `<b class="${t===0?'b':t===1?'r':'g'}">${ic}${label}</b>`;
}
function evHTML(e, players){
  const tm = v => v==null?null:(Math.round(v)===1?0:1);
  let ic='•', body='';
  switch(CAT(e)){
    case 'kill':{ ic='💀';
      body=`${nameHTML(e.player,players)} 처치됨 <span class="dim">←</span> `+
        (e.killers||[]).map(k=>nameHTML(k,players)).join(', '); break; }
    case 'struct':{ ic='🏰';
      const u=(e.UnitType||e.unit||'건물').replace(/^Town/,'');
      body=`<b class="g">${u}</b> 파괴` + (e.killers?` <span class="dim">←</span> `+e.killers.map(k=>nameHTML(k,players)).join(', '):''); break; }
    case 'merc':{ ic='⚔️'; body=`${span((e.CampType||'용병'), tm(e.TeamID))} 점령 <span class="dim">(캠프 ${e.CampID??'?'} · ${tm(e.TeamID)===0?'1팀':'2팀'})</span>`; break; }
    case 'obj':{ ic='🪶'; body=`<b class="g">${e.e}</b>` + (e.TeamID?` <span class="dim">${tm(e.TeamID)===0?'1팀':'2팀'}</span>`:''); break; }
    case 'grow':{ ic='⬆';
      body = e.e==='LevelUp' ? `${nameHTML(e.player??'?',players)} <span class="dim">레벨 ${e.Level??''}</span>`
           : `${nameHTML(e.player??'?',players)} <span class="dim">특성: ${e.PurchaseName??''}</span>`; break; }
    default:{ body=`<b class="g">${e.e}</b>`; }
  }
  return `<span class="t">${fmtT(e.t)}</span><span class="ic">${ic}</span><span>${body}</span>`;
}
