/* ================= 조립: 재생 루프 · 컨트롤 · 로드 · 부트 ================= */

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
    if(G){
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
  document.getElementById('teamInfo').innerHTML=
    `<b class="b">1팀</b> ${t0.map(chip).join('')} <span style="opacity:.5">vs</span> <b class="r">2팀</b> ${t1.map(chip).join('')}`;
  // 영웅 미니맵 아이콘 준비 (이름 -> 내장 아이콘)
  for(const lab in G.heroes){
    const h=G.heroes[lab], hd=heroByName(h.heroName);
    if(hd){ const im=new Image(); im.src='icons/'+hd.icon; im.onload=markDirty; h.img=im; }
  }
  // 맵 이름으로 배경 자동 선택 + 리플레이의 전장으로 고정
  const m=matchMap(raw.map);
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
  closeRep.style.display='';
  markDirty(); renderLog();
}
/* 리플레이가 아는 전장이면 맵 선택을 잠근다 (어긋난 배경 방지) */
function setMapLock(on){
  mapSel.disabled=on;
  mapSel.title=on?'리플레이의 전장으로 고정됨 (리플레이를 닫으면 바꿀 수 있다)':'배경 맵 선택';
  document.getElementById('bgLabel').style.display=on?'none':'';
}
/* 리플레이를 닫고 맵 보기로 돌아간다. 판서·핀은 그대로 둔다 */
const closeRep=document.getElementById('closeRep');
closeRep.onclick=()=>{
  G=null; tCur=0; playing=false; logCount=-1;
  playBtn.textContent='▶ 재생'; seek.value=0; clock.firstChild.textContent='00:00';
  document.getElementById('mapName').textContent='';
  setTeamHint();
  logEl.innerHTML='<div class="empty">리플레이를 열면 이벤트가 여기에 표시됩니다</div>';
  closeRep.style.display='none';
  setMapLock(false);
  markDirty();
};
function setTeamHint(){
  document.getElementById('teamInfo').innerHTML=
    '<span class="dim">리플레이를 열면 재생됩니다 · 🖌 도구로 전술 작성</span>';
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
closeRep.style.display='none';
const START_MAP='cursed_hollow';
const startM=MAP_DB.find(m=>m.slug===START_MAP)||MAP_DB[0];
if(startM) loadMapBySlug(startM.slug);
requestAnimationFrame(tick);
