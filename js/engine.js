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
  // 스킬 조준점 — 이동 목적지가 아니라 «그때 사거리 안에 있었다»는 약한 단서
  for(const nm in (raw.ability_aims||{})){
    const lab = heroes[nm] ? nm : (label[nm] || nm);
    if(!heroes[lab]) continue;
    for(const p of raw.ability_aims[nm]) heroes[lab].pts.push({t:p[0],x:p[1],y:p[2],src:'a'});
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

/* 이동 재구성. 근거의 세기 순으로 층을 쌓는다.
     1) 위치 스냅샷(s/c/r/d) — 게임이 남긴 «사실». 무조건 최우선.
     2) 이동 명령(m) — 유저가 찍은 곳. 그쪽으로 최대 이속으로 간다.
     3) 스킬 조준점(a) — 그 순간 시전자가 조준점 사거리 안에 있었다는 «약한 사실».
        멀리 벗어나 있으면 사거리 안으로 당긴다 (표본 8경기에서 평균 오차 -19.8%).
     4) 지형 — 못 가는 칸은 통과하지 못하고, 벽 건너편을 찍으면 길찾기로 돌아간다.
   원본 스냅샷이 15초 간격이라 그 사이는 어차피 추정이다. 여기서 촘촘한 격자로
   한 번 풀어 두고 posAt 에서 다시 보간하면 60fps 로 이어져 보인다. */
const PDT=0.1, SPEED=5.5, SNAP_DIST=10;
// 전투 스냅샷 보정 비율(스텝당). 한 번에 60% 를 당기면 그 프레임만 툭 튀므로
// 여러 스텝에 나눠 수렴시킨다. 0.25 면 스냅샷 간격(약 1초=10스텝)에 대부분 따라잡는다.
const CORR=0.25;
const AIM_R=7;            // 스킬 조준점 앵커의 사거리 (월드 유닛)
const F=Float32Array, U=Uint8Array;

function buildPath(pts, maxT){
  const n=Math.floor((maxT+PDT)/PDT)+1;
  const xs=new F(n), ys=new F(n), fl=new U(n);   // fl: 0=없음 1=살아있음 2=사망
  let cx=0, cy=0, has=false, tx=0, ty=0, hasT=false, dead=false, i=0;
  let sx=0, sy=0, hasS=false;                    // 수렴 중인 전투 스냅샷 목표
  let route=null, ri=0;                          // 길찾기 경로와 진행 위치
  let lastFix=-1;                                // 마지막으로 실측 좌표를 적용한 시각
  // 첫 점이 한참 뒤에 있는 리플레이(난투 등)는 그 전 구간이 통째로 비어
  // 영웅이 안 그려졌다. 첫 위치를 시작부터 깔아 둔다.
  const first=pts.find(p=>p.src!=='m'&&p.src!=='a');
  if(first){ cx=first.x; cy=first.y; has=true; }
  const setTarget=(x,y)=>{ tx=x; ty=y; hasT=true; route=null; ri=0; };
  for(let k=0;k<n;k++){
    const t=k*PDT;
    while(i<pts.length && pts[i].t<=t){
      const p=pts[i++];
      if(p.src==='m') setTarget(p.x,p.y);
      else if(p.src==='j'){                      // 이동기(도약·돌진·점멸) — 바로 옮긴다
        if(has && !dead){ cx=p.x; cy=p.y; hasT=false; hasS=false; route=null; }
      }
      else if(p.src==='a'){                      // 스킬 조준점 — 사거리 밖이면 당긴다
        // 같은 초에 실측 스냅샷이 있었으면 그쪽이 사실이므로 건드리지 않는다
        if(has && !dead && p.t!==lastFix){
          const dx=p.x-cx, dy=p.y-cy, d=Math.hypot(dx,dy);
          if(d>AIM_R){ const f=(d-AIM_R)/d; cx+=dx*f; cy+=dy*f; route=null; }
        }
      }
      else if(p.src==='s'||p.src==='r'){ cx=p.x; cy=p.y; has=true; dead=false; hasT=false; hasS=false; route=null; lastFix=p.t; }
      else if(p.src==='d'){ cx=p.x; cy=p.y; has=true; dead=true; hasT=false; hasS=false; route=null; lastFix=p.t; }
      else if(p.src==='c'){
        if(!has){ cx=p.x; cy=p.y; has=true; hasS=false; }
        else if(Math.hypot(p.x-cx,p.y-cy)>SNAP_DIST){ cx=p.x; cy=p.y; hasS=false; route=null; }
        else { sx=p.x; sy=p.y; hasS=true; }      // 가까우면 부드럽게 끌어당긴다
        dead=false;
      }
    }
    if(has && !dead){
      if(hasS){                                  // 스냅샷 쪽으로 조금씩 수렴
        cx+=(sx-cx)*CORR; cy+=(sy-cy)*CORR;
        if(Math.hypot(sx-cx,sy-cy)<0.05){ cx=sx; cy=sy; hasS=false; }
      }
      if(hasT){
        // 목적지가 벽 건너편이면 한 번만 길을 찾아 두고 그 경로를 따라간다
        if(!route && typeof findPath==='function' && !clearLine(cx,cy,tx,ty)){
          route=findPath(cx,cy,tx,ty) || false; ri=0;
        }
        let step=SPEED*PDT;
        while(step>1e-6){
          const wp = (route && ri<route.length) ? route[ri] : [tx,ty];
          const dx=wp[0]-cx, dy=wp[1]-cy, d=Math.hypot(dx,dy);
          if(d<=step){
            // 지형을 못 뚫는다. 막혀 있으면 그 자리에서 멈춘다.
            if(canGo(cx,cy,wp[0],wp[1])){ cx=wp[0]; cy=wp[1]; }
            else { hasT=false; route=null; break; }
            step-=d;
            if(route && ri<route.length){ ri++; if(ri>=route.length){ route=null; hasT=false; break; } }
            else { hasT=false; break; }          // 목적지 도착
          }else{
            const nx=cx+dx/d*step, ny=cy+dy/d*step;
            if(canGo(cx,cy,nx,ny)){ cx=nx; cy=ny; }
            else { hasT=false; route=null; }
            break;
          }
        }
      }
    }
    xs[k]=cx; ys[k]=cy; fl[k]=has? (dead?2:1) : 0;
  }
  return {n,xs,ys,fl};
}
/* 지형 격자가 없으면 늘 통과 (기존 동작 유지) */
function canGo(x0,y0,x1,y1){
  return (typeof clearLine!=='function') ? true : clearLine(x0,y0,x1,y1);
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
