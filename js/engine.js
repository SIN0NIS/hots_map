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
    const lab = label[nm] || nm;
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

/* 속도제한 추적 시뮬레이션: 스냅샷 사이를 이동 명령과 최대 이속으로 메꾼다 */
const PDT=0.25, SPEED=5.5, SNAP_DIST=10;
function buildPath(pts, maxT){
  const out=[]; let cur=null, target=null, dead=false, i=0;
  for(let t=0;t<=maxT+PDT;t+=PDT){
    while(i<pts.length && pts[i].t<=t){
      const p=pts[i++];
      if(p.src==='m') target={x:p.x,y:p.y};
      else if(p.src==='s'){ cur={x:p.x,y:p.y}; dead=false; target=null; }
      else if(p.src==='d'){ cur={x:p.x,y:p.y}; dead=true; target=null; }
      else if(p.src==='c'){
        if(!cur) cur={x:p.x,y:p.y};
        else{ const dx=p.x-cur.x, dy=p.y-cur.y;
          if(Math.hypot(dx,dy)>SNAP_DIST) cur={x:p.x,y:p.y};
          else { cur.x+=dx*.6; cur.y+=dy*.6; } }
        dead=false;
      }
    }
    if(cur && !dead && target){
      const dx=target.x-cur.x, dy=target.y-cur.y, d=Math.hypot(dx,dy), step=SPEED*PDT;
      if(d<=step) cur={x:target.x,y:target.y};
      else { cur={x:cur.x+dx/d*step, y:cur.y+dy/d*step}; }
    }
    out.push(cur? {x:cur.x, y:cur.y, dead} : null);
  }
  return out;
}
function posAt(h, t){
  if(!h.path || !h.path.length) return null;
  return h.path[Math.max(0, Math.min(h.path.length-1, Math.round(t/PDT)))];
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
