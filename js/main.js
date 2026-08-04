/* ================= 조립: 모드 · 재생 루프 · 컨트롤 · 로드 · 부트 ================= */

/* --- 상단 모드 탭 ---
   'map'    지도만 본다. 재생바·로그를 감추고 리플레이 표기도 그리지 않는다.
   'replay' 리플레이를 재생한다. 리플레이의 전장으로 배경을 되돌린다. */
let uiMode='map';
let repSlug=null;                 // 지금 열린 리플레이의 전장 (맵 보기에서 딴 맵을 봐도 기억)
let rosterHTML='';                // 리플레이 보기에서 보여줄 팀 명단
function setUIMode(m){
  uiMode=m;
  document.body.classList.toggle('mode-map', m==='map');
  document.body.classList.toggle('mode-replay', m==='replay');
  document.querySelectorAll('#modebar .tab').forEach(b=>
    b.classList.toggle('on', b.dataset.mode===m));
  const ti=document.getElementById('teamInfo');
  if(m==='replay'){
    // 맵 보기에서 다른 전장을 구경했다면 리플레이의 전장으로 되돌린다
    if(G && repSlug && repSlug!==curMapSlug) loadMapBySlug(repSlug);
    setMapLock(!!(G && repSlug));
    ti.innerHTML = rosterHTML || '';
  }else{
    playing=false; playBtn.textContent='▶ 재생';
    setMapLock(false);                       // 맵 보기에서는 전장을 자유롭게 고른다
    setTeamHint();                           // 팀 명단은 리플레이 보기에서만
  }
  logCount=-1; markDirty();
  requestAnimationFrame(fit);                // 패널이 접혔다 펴지므로 크기를 다시 잡는다
}
document.querySelectorAll('#modebar .tab').forEach(b=>
  b.onclick=()=>setUIMode(b.dataset.mode));

/* --- 재생 루프 --- */
const clock=document.getElementById('clock'), seek=document.getElementById('seek'), playBtn=document.getElementById('play');
function tick(ts){
  if(playing && G){
    if(lastTs) tCur=Math.min(G.maxT, tCur+(ts-lastTs)/1000*speed);
    if(tCur>=G.maxT){playing=false;playBtn.textContent='▶ 재생';}
    needsDraw=true;
  }
  lastTs=ts;
  if(needsDraw){
    if(G && uiMode==='replay'){
      seek.value=tCur/G.maxT*100;
      clock.firstChild.textContent=fmtT(tCur);
      renderLog();
    }
    draw();
  }
  requestAnimationFrame(tick);
}
playBtn.onclick=()=>{ if(!G)return; if(tCur>=G.maxT)tCur=0;
  playing=!playing; playBtn.textContent=playing?'⏸ 정지':'▶ 재생'; markDirty(); };
seek.oninput=()=>{ if(G){ tCur=seek.value/100*G.maxT; logCount=-1; markDirty(); } };
document.querySelectorAll('.spd').forEach(b=>b.onclick=()=>{
  speed=+b.dataset.s;
  document.querySelectorAll('.spd').forEach(x=>x.classList.toggle('on',x===b)); });

/* --- 보정/표시 컨트롤 --- */
const calL=document.getElementById('calL'), calR=document.getElementById('calR'),
      calB=document.getElementById('calB'), calT=document.getElementById('calT');
function syncCalInputs(){ if(!cal) return;
  calL.value=cal.L; calR.value=cal.R; calB.value=cal.B; calT.value=cal.T; }
for(const [el,k] of [[calL,'L'],[calR,'R'],[calB,'B'],[calT,'T']])
  el.oninput=()=>{ if(cal){ cal[k]=+el.value; markDirty(); } };
document.getElementById('bgAlpha').oninput=e=>{ bgAlpha=e.target.value/100; markDirty(); };
document.getElementById('showStruct').onchange=e=>{ showStruct=e.target.checked; markDirty(); };
document.getElementById('heroIconTgl').onchange=e=>{ showHeroIcons=e.target.checked; markDirty(); };

/* --- 리플레이 로드 --- */
function load(raw){
  G=prepare(raw); tCur=0; playing=false; logCount=-1;
  playBtn.textContent='▶ 재생';
  document.getElementById('mapName').textContent=raw.map||'';
  const t0=[],t1=[];
  for(const k in raw.players){const p=raw.players[k];(p.team===0?t0:t1).push(p);}
  const chip=p=>{
    const hd=heroByName(p.hero);
    return `<span class="hp" title="${p.name}">${hd?`<img src="icons/${hd.icon}" alt="">`:''}${p.hero}</span>`;
  };
  rosterHTML=`<b class="b">1팀</b> ${t0.map(chip).join('')} <span style="opacity:.5">vs</span> <b class="r">2팀</b> ${t1.map(chip).join('')}`;
  document.getElementById('teamInfo').innerHTML=rosterHTML;
  // 영웅 미니맵 아이콘 준비 (이름 -> 내장 아이콘)
  for(const lab in G.heroes){
    const h=G.heroes[lab], hd=heroByName(h.heroName);
    if(hd){ const im=new Image(); im.src='icons/'+hd.icon; im.onload=markDirty; h.img=im; }
  }
  // 맵 이름으로 배경 자동 선택 + 리플레이의 전장으로 고정
  const m=matchMap(raw.map);
  repSlug = m ? m.slug : null;
  if(m){
    setMapLock(true);
    if(m.slug!==curMapSlug) loadMapBySlug(m.slug);   // 그림틀·cal 은 여기서 잡는다
    else { cal={...bgAutoCal}; syncCalInputs(); }
  }else{
    // 뷰어가 모르는 전장 — 리플레이 좌표에 맞춰 틀을 잡는다
    setMapLock(false);
    if(!bgImg){
      cal = { L:Math.round(G.bounds.minX), R:Math.round(G.bounds.maxX),
              B:Math.round(G.bounds.minY), T:Math.round(G.bounds.maxY) };
      setViewBounds(G.bounds); setupCanvas(); fit();
    }
    syncCalInputs();
  }
  document.body.classList.add('has-replay');
  setUIMode('replay');            // 리플레이를 열면 바로 재생 화면으로
  markDirty(); renderLog();
}
/* 리플레이 보기에서 전장이 어긋나지 않도록 맵 선택을 잠근다.
   (맵 보기에서는 항상 풀려 있어 자유롭게 전장을 구경할 수 있다) */
function setMapLock(on){
  mapSel.disabled=on;
  mapSel.title=on?'리플레이의 전장으로 고정됨 (맵 보기에서는 자유롭게 바꿀 수 있다)':'배경 맵 선택';
}
/* 리플레이를 닫고 맵 보기로 돌아간다. 판서·핀은 그대로 둔다 */
const closeRep=document.getElementById('closeRep');
closeRep.onclick=()=>{
  G=null; repSlug=null; rosterHTML=''; tCur=0; playing=false; logCount=-1;
  playBtn.textContent='▶ 재생'; seek.value=0; clock.firstChild.textContent='00:00';
  document.getElementById('mapName').textContent='';
  setTeamHint();
  logEl.innerHTML='<div class="empty">리플레이를 열면 이벤트가 여기에 표시됩니다</div>';
  document.body.classList.remove('has-replay');
  setUIMode('map');
};
function setTeamHint(){
  document.getElementById('teamInfo').innerHTML=
    '<span class="dim">🖌 도구로 지도 위에 전술을 그릴 수 있습니다</span>';
}

document.getElementById('file').onchange=async ev=>{
  const f=ev.target.files[0]; if(!f)return;
  ev.target.value='';
  try{
    if(/\.stormreplay$/i.test(f.name)){
      const raw = await parseReplay(f);
      load(raw);
      setStatus('파싱 완료: '+f.name+' — 재생을 누르세요');
    } else load(JSON.parse(await f.text()));
  }catch(err){ alert('읽기 실패: '+err.message); setStatus(''); }
};

/* --- 예제 리플레이 --- */
const sampleSel=document.getElementById('sampleSel');
// 데모는 내장 데이터라 파싱도 인터넷도 필요 없다 — file:// 에서도 된다
if(typeof DEMO_REPLAY!=='undefined' && DEMO_REPLAY){
  const o=document.createElement('option');
  o.value='__demo__'; o.textContent='데모: 저주받은 골짜기';
  sampleSel.appendChild(o);
}
// 나머지 예제는 파일을 받아 파싱해야 하므로 웹 서버로 열었을 때만 (file:// 는 fetch 불가)
if(location.protocol!=='file:' && typeof SAMPLE_DB!=='undefined'){
  for(const s of SAMPLE_DB){
    const o=document.createElement('option');
    o.value=s.file; o.textContent=`${s.ko} (${Math.round(s.kb/100)/10}MB)`;
    sampleSel.appendChild(o);
  }
}
sampleSel.onchange=async ()=>{
  const f=sampleSel.value; if(!f) return;
  sampleSel.value='';
  if(f==='__demo__'){ load(DEMO_REPLAY); setStatus('데모 리플레이 — 재생을 누르세요'); return; }
  try{
    showLoading('샘플 내려받는 중…');
    const res=await fetch(f);
    if(!res.ok) throw new Error('HTTP '+res.status);
    const blob=await res.blob();
    hideLoading();
    const raw=await parseReplay(new File([blob], f.split('/').pop()));
    load(raw);
    setStatus('파싱 완료 — 재생을 누르세요');
  }catch(err){ hideLoading(); alert('샘플 로드 실패: '+err.message); setStatus(''); }
};

/* --- 키보드 --- */
window.addEventListener('keydown',function(e){
  const typing=/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName||'');
  if(toolOn){
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){ e.preventDefault(); undo(); return; }
    if(e.key==='Escape'){ setMode('pan'); return; }
    if((e.key==='Delete'||e.key==='Backspace')&&selObj&&!typing){ delObj(selObj,true); return; }
  }
  if(typing||!G) return;
  if(e.code==='Space'){ e.preventDefault(); playBtn.onclick(); }
  else if(e.key==='ArrowRight'){ tCur=Math.min(G.maxT,tCur+5); logCount=-1; markDirty(); }
  else if(e.key==='ArrowLeft'){ tCur=Math.max(0,tCur-5); logCount=-1; markDirty(); }
});

/* --- 부트: 맵 보기로 시작한다 (리플레이를 열면 재생 모드로 바뀐다) --- */
setTeamHint();
setUIMode('map');
const START_MAP='cursed_hollow';
const startM=MAP_DB.find(m=>m.slug===START_MAP)||MAP_DB[0];
if(startM) loadMapBySlug(startM.slug);
requestAnimationFrame(tick);
