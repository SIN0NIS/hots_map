/* ================= 상단 팀 바 =================
   좌우 5명씩 초상화 + 특성 픽. 특성 칸은 지금 시각까지 찍은 것만 채워진다.
   (리플레이의 TalentChosen 은 내부 이름이라 TALENT_DB 로 한국어명을 붙인다) */
const TIERS = [1,4,7,10,13,16,20];
const teamEls = [document.getElementById('team0'), document.getElementById('team1')];
let plCards = [];        // {lab, el, pips:[], lvEl, talents:[{t,lv,ko}], shown}

function talentInfo(name){
  const d = (typeof TALENT_DB!=='undefined') ? TALENT_DB[name] : null;
  if(d) return { ko: d.ko || name, lv: d.lv, ic: d.ic || '' };
  // 표에 없는 특성은 내부명을 읽기 좋게 푼다:
  // "KerriganFuryOfTheSwarm" -> "Fury Of The Swarm" (영웅 이름 접두어는 뗀다)
  let s = String(name||'');
  for(const h of HERO_DB){
    const en = h.en.replace(/[^A-Za-z]/g,'');
    if(en && s.startsWith(en)){ s = s.slice(en.length); break; }
  }
  s = s.replace(/^(HeroicAbility|Mastery|Talent)/,'')
       .replace(/([a-z0-9])([A-Z])/g,'$1 $2').trim();
  return { ko: s || name, lv: null, ic: '' };
}

function buildTeamBar(){
  plCards = [];
  teamEls.forEach(el=>el.replaceChildren());
  if(!G) return;
  // 플레이어별 특성 픽과 레벨업을 시간순으로 모은다
  const picks = {}, levels = {};
  for(const e of G.evs){
    if(e.e==='TalentChosen' && e.player){
      const info = talentInfo(e.PurchaseName||'');
      (picks[e.player] ||= []).push({t:e.t, ko:info.ko, lv:info.lv, ic:info.ic});
    }else if(e.e==='LevelUp' && e.player && e.Level!=null){
      (levels[e.player] ||= []).push({t:e.t, lv:+e.Level});
    }
  }
  for(const k in picks) picks[k].sort((a,b)=>a.t-b.t);
  for(const k in levels) levels[k].sort((a,b)=>a.t-b.t);

  for(const lab in G.heroes){
    const hh = G.heroes[lab];
    const team = hh.team===1 ? 1 : 0;
    const hd = heroByName(hh.heroName);
    const card = document.createElement('div');
    card.className = 'pl ' + (team===0?'b':'r');
    card.title = lab;

    const por = document.createElement('div'); por.className='por';
    if(hd){ const im=document.createElement('img'); im.src='icons/'+hd.icon; im.alt=hh.heroName; por.appendChild(im); }
    const lv = document.createElement('span'); lv.className='lv'; lv.textContent='1';
    por.appendChild(lv);
    card.appendChild(por);

    const nm = document.createElement('span'); nm.className='nm'; nm.textContent=hh.heroName;
    card.appendChild(nm);

    const tal = document.createElement('div'); tal.className='tal';
    const list = picks[lab] || [];
    const pips = [];
    // 티어 7칸을 고정으로 두고, 찍은 특성을 레벨에 맞춰 채운다.
    // 레벨을 모르는 특성(표에 없는 것)은 찍은 순서대로 남은 칸에 넣는다.
    const byTier = {};
    const rest = [];
    for(const p of list){
      if(p.lv && !byTier[p.lv]) byTier[p.lv]=p; else rest.push(p);
    }
    // 티어 7칸 고정. 찍은 특성은 아이콘으로, 아직 안 찍은 칸은 빈 자리로 둔다.
    for(const tier of TIERS){
      const i = document.createElement('i');
      const p = byTier[tier] || rest.shift();
      if(p){
        i.dataset.t=p.t;
        i.title=`${tier} 레벨 · ${p.ko}`;
        if(p.ic){
          const im=document.createElement('img');
          im.src='talents/'+p.ic+'.webp'; im.alt=p.ko;   // 항상 보이는 바라 lazy 는 쓰지 않는다
          i.appendChild(im);
        }else i.classList.add('noic');   // 아이콘을 못 찾은 특성
      }else i.title=`${tier} 레벨`;
      tal.appendChild(i); pips.push(i);
    }
    card.appendChild(tal);

    teamEls[team].appendChild(card);
    plCards.push({lab, card, pips, lvEl:lv, hh, levels: levels[lab]||[]});
  }
}

/* 지금 시각 기준으로 갱신 — 레벨, 생사, 찍은 특성 */
function updateTeamBar(){
  if(!G || !plCards.length) return;
  for(const c of plCards){
    const p = posAt(c.hh, tCur);
    const dead = !!(p && p.dead);
    if(c.card.classList.contains('dead')!==dead) c.card.classList.toggle('dead',dead);
    let got=0;
    for(const i of c.pips){
      const t = i.dataset.t;
      const on = t!==undefined && +t<=tCur;
      if(i.classList.contains('got')!==on) i.classList.toggle('got',on);
      const fresh = on && tCur-+t<3;
      if(i.classList.contains('fresh')!==fresh) i.classList.toggle('fresh',fresh);
      if(on) got++;
    }
    // 레벨은 LevelUp 이벤트가 정확하다. 없으면 찍은 특성 티어로 어림한다.
    let lv = 1;
    if(c.levels.length){
      for(const L of c.levels){ if(L.t<=tCur) lv=L.lv; else break; }
    }else if(got) lv = TIERS[got-1];
    if(c.lvEl.textContent!==String(lv)) c.lvEl.textContent=lv;
  }
}
