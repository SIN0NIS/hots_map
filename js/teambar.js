/* ================= 상단 스코어보드 (게임 화면처럼) =================
   좌 1팀 5명 · 가운데 시간/팀레벨/킬/건물 · 우 2팀 5명.
   선수 한 명 = 초상화(레벨·생사) + 특성 7칸 + 스킬 사용 표시.
   (특성 내부명은 TALENT_DB 로 한국어·아이콘을 붙인다) */
const TIERS = [1,4,7,10,13,16,20];
const teamEls = [document.getElementById('top0'), document.getElementById('top1')];
let plCards = [];

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

/* 공용 스킬 번호 — 기본 공격·탈것·귀환이라 «스킬 사용»에서 뺀다
   (실측: 26=공격/A이동, 111=탈것, 115=귀환, 나머지는 좌표 없는 공용) */
const SHARED_ABIL = new Set([22,23,26,41,45,66,77,110,111,115,172,788,789,796,137,138]);
const SK_SLOTS = 5;

function buildTeamBar(){
  plCards = [];
  teamEls.forEach(el=>el.replaceChildren());
  if(!G) return;
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
    card.appendChild(por);

    const col = document.createElement('div'); col.className='col';
    const nm = document.createElement('span'); nm.className='nm'; nm.textContent=hh.heroName;
    col.appendChild(nm);

    // 특성 7칸
    const tal = document.createElement('div'); tal.className='tal';
    const list = picks[lab] || [], pips = [], byTier = {}, rest = [];
    for(const p of list){ if(p.lv && !byTier[p.lv]) byTier[p.lv]=p; else rest.push(p); }
    for(const tier of TIERS){
      const i = document.createElement('i');
      const p = byTier[tier] || rest.shift();
      if(p){
        i.dataset.t=p.t; i.title=`${tier} 레벨 · ${p.ko}`;
        if(p.ic){ const im=document.createElement('img'); im.src='talents/'+p.ic+'.webp'; im.alt=p.ko; i.appendChild(im); }
        else i.classList.add('noic');
      }else i.title=`${tier} 레벨`;
      tal.appendChild(i); pips.push(i);
    }
    col.appendChild(tal);

    // 스킬 사용 — 이 영웅이 쓴 «고유 스킬 번호»를 처음 쓴 순서로 칸에 배정하고,
    // 그 스킬을 방금 썼으면 칸에 불이 들어온다. (번호가 Q/W/E/R 중 무엇인지는
    // 리플레이만으로 알 수 없어 «슬롯»으로만 보여준다)
    const casts = (hh.pts||[]).filter(p=>p.src==='a' && p.link!=null && !SHARED_ABIL.has(p.link));
    const order = [];
    for(const c of casts) if(!order.includes(c.link) && order.length<SK_SLOTS) order.push(c.link);
    const sk = document.createElement('div'); sk.className='sk';
    const slots = order.map((lk,i)=>{
      const u=document.createElement('u');
      u.title=`스킬 ${i+1} (번호 ${lk}) · ${casts.filter(c=>c.link===lk).length}회 사용`;
      sk.appendChild(u); return {el:u, link:lk};
    });
    col.appendChild(sk);
    // 통계 줄 — 페이지(특성/KDA/APM/XP)에 따라 내용이 바뀐다
    const stat=document.createElement('div'); stat.className='stat';
    col.appendChild(stat);
    card.appendChild(col);

    teamEls[team].appendChild(card);
    plCards.push({lab, card, pips, hh, slots, tal, stat, lv:1,
                  casts: casts.map(c=>({t:c.t, link:c.link})),
                  levels: levels[lab]||[]});
  }
  applyPage();
}

/* --- 통계 페이지 (참고: SpazzoReplayStatKit 의 Control+1~6 방식) --- */
let statPage='tal';
const pageTabs=document.getElementById('pageTabs');
pageTabs.querySelectorAll('button').forEach(b=>b.onclick=()=>{
  statPage=b.dataset.p;
  pageTabs.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
  applyPage(); updateTeamBar();
});
function applyPage(){
  for(const c of plCards){
    c.tal.style.display = statPage==='tal' ? 'flex' : 'none';
    c.stat.style.display = statPage==='tal' ? 'none' : 'flex';
  }
}
/* 지금 시각까지의 선수별 «처치 관여 / 데스».
   리플레이의 KillingPlayer 는 «관여자 목록»이라 누가 막타인지는 알 수 없다.
   그래서 킬/어시로 나누지 않고 히오스 기준인 처치 관여(Takedown)로 센다. */
function kdaAt(){
  const r={};
  for(const c of plCards) r[c.lab]={td:0,d:0};
  for(const e of G.evs){
    if(e.t>tCur) break;
    if(e.e!=='PlayerDeath') continue;
    if(r[e.player]) r[e.player].d++;
    for(const n of (e.killers||[])) if(r[n]) r[n].td++;
  }
  return r;
}
/* 지금 시각까지 죽어 있던 시간 (경로에서 직접 센다) */
function deadSecs(hh){
  const P=hh.path; if(!P||!P.n) return 0;
  const last=Math.min(P.n-1, Math.floor(tCur/PDT));
  let n=0; for(let k=0;k<=last;k++) if(P.fl[k]===2) n++;
  return Math.round(n*PDT);
}
/* 지금 시각 기준 갱신 — 레벨·생사·특성·스킬 사용 */
function updateTeamBar(){
  if(!G || !plCards.length) return;
  const CAST_HOLD = 1.2;                  // 스킬 표시를 켜 두는 시간(초)
  for(const c of plCards){
    const p = posAt(c.hh, tCur);
    const dead = !!(p && p.dead);
    if(c.card.classList.contains('dead')!==dead) c.card.classList.toggle('dead',dead);
    let got=0;
    for(const i of c.pips){
      const t=i.dataset.t, on = t!==undefined && +t<=tCur;
      if(i.classList.contains('got')!==on) i.classList.toggle('got',on);
      const fresh = on && tCur-+t<3;
      if(i.classList.contains('fresh')!==fresh) i.classList.toggle('fresh',fresh);
      if(on) got++;
    }
    let lv=1;
    if(c.levels.length){ for(const L of c.levels){ if(L.t<=tCur) lv=L.lv; else break; } }
    else if(got) lv=TIERS[got-1];
    c.lv=lv;                       // 초상화에 겹쳐 쓰지 않는다 — 팀 레벨은 가운데에 크게 있다
    c.card.title = `${c.lab} · 레벨 ${lv}`;
    // 최근에 쓴 스킬
    const hot=new Set();
    for(const k of c.casts){ if(k.t<=tCur && tCur-k.t<CAST_HOLD) hot.add(k.link); }
    for(const s of c.slots){
      const on=hot.has(s.link);
      if(s.el.classList.contains('hot')!==on) s.el.classList.toggle('hot',on);
    }
    const casting = hot.size>0;
    if(c.card.classList.contains('cast')!==casting) c.card.classList.toggle('cast',casting);
  }
  if(statPage!=='tal') fillStats();
  updateScore();
}

/* 페이지별 통계 채우기 */
function fillStats(){
  const kda = statPage==='kda' ? kdaAt() : null;
  const min = Math.max(1, Math.floor(tCur/60));
  for(const c of plCards){
    let h='';
    if(statPage==='kda'){
      const v=kda[c.lab]||{td:0,d:0};
      h=`<s class="k">${v.td}</s>관여 <s class="d">${v.d}</s>데스`;
    }else if(statPage==='apm'){
      // 지금까지의 평균 APM (분당 명령 수) + 죽어 있던 시간
      const b=(G.apm||{})[c.lab]||{};
      let tot=0; for(const m in b){ if(+m<min) tot+=b[m]; }
      const dead=deadSecs(c.hh);
      h=`<s>${Math.round(tot/min)}</s>apm <s class="d">${Math.floor(dead/60)}:${String(dead%60).padStart(2,'0')}</s>사망`;
    }else if(statPage==='xp'){
      const x=(G.xpEnd||{})[c.lab];
      h = x ? `<s>${Math.round(x/1000)}k</s>경험치` : '<s>-</s>';
    }
    if(c.stat.innerHTML!==h) c.stat.innerHTML=h;
  }
}

/* 가운데: 시간 · 팀 레벨 · 킬 · 건물 */
const tClock=document.getElementById('tClock');
const tLv=[document.getElementById('tLv0'),document.getElementById('tLv1')];
const tK=[document.getElementById('tK0'),document.getElementById('tK1')];
const tS=[document.getElementById('tS0'),document.getElementById('tS1')];
function updateScore(){
  if(!G) return;
  tClock.textContent = fmtT(tCur);
  // 팀 레벨은 경험치 표본이 정확하다. 없으면 선수 최고 레벨로 어림한다.
  const lv=[1,1];
  for(const r of (G.teamXp||[])) if(r.t<=tCur) lv[r.team]=r.lv;
  if(!(G.teamXp||[]).length)
    for(const c of plCards) lv[c.hh.team===1?1:0]=Math.max(lv[c.hh.team===1?1:0], c.lv||1);
  const k=[0,0], s=[0,0];
  for(const e of G.evs){
    if(e.t>tCur) break;
    const cat=CAT(e), tm=eventTeam(e,G.players);
    if(tm!==0&&tm!==1) continue;
    if(cat==='kill') k[tm]++;
    // 건물 수는 하단 타임라인에 찍히는 것과 같게 센다 — 성벽·성문·우물까지 세면
    // 화면의 표식 개수와 숫자가 어긋나 보인다
    else if(cat==='struct' && (typeof structKind!=='function' || structKind(e.UnitType||e.unit).big)) s[tm]++;
  }
  // 다음 레벨까지 남은 경험치 (문턱값은 표본에서 뽑은 추정치라 «약» 이다)
  const cur=[null,null];
  for(const r of (G.teamXp||[])) if(r.t<=tCur) cur[r.team]=r;
  for(let i=0;i<2;i++){
    if(tLv[i].textContent!==String(lv[i])) tLv[i].textContent=lv[i];
    const need = (typeof lvXp==='function') ? lvXp(lv[i]+1) : null;
    const now = cur[i] ? cur[i].minion+cur[i].creep+cur[i].hero+cur[i].struct+cur[i].trickle : null;
    tLv[i].title = (need!=null && now!=null)
      ? `${i+1}팀 레벨 ${lv[i]} · 경험치 ${Math.round(now).toLocaleString()}
`
        +`레벨 ${lv[i]+1} 까지 약 ${Math.max(0,Math.round(need-now)).toLocaleString()} (문턱 약 ${need.toLocaleString()})`
      : `${i+1}팀 레벨 ${lv[i]}`;
    if(tK[i].textContent!==String(k[i])) tK[i].textContent=k[i];
    if(tS[i].textContent!==String(s[i])) tS[i].textContent=s[i];
  }
}
