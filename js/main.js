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
  if(G && needsDraw){
    seek.value=tCur/G.maxT*100;
    clock.firstChild.textContent=fmtT(tCur);
    draw(); renderLog();
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
  cal = { L:Math.round(G.bounds.minX), R:Math.round(G.bounds.maxX),
          B:Math.round(G.bounds.minY), T:Math.round(G.bounds.maxY) };
  if(bgAutoCal) cal={...bgAutoCal};
  // 맵 이름으로 배경 자동 선택 + 리플레이의 전장으로 고정
  const m=matchMap(raw.map);
  if(m && m.slug!==curMapSlug) loadMapBySlug(m.slug);
  else if(m && bgAutoCal){ cal={...bgAutoCal}; }
  setMapLock(!!m);
  syncCalInputs();
  setupCanvas(); fit(); markDirty(); renderLog();
}
/* 리플레이가 아는 전장이면 맵 선택을 잠근다 (어긋난 배경 방지) */
function setMapLock(on){
  mapSel.disabled=on;
  mapSel.title=on?'리플레이의 전장으로 고정됨':'배경 맵 선택';
  document.getElementById('bgLabel').style.display=on?'none':'';
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

/* --- 샘플 리플레이 (웹 서버로 열었을 때만 — file:// 는 fetch 불가) --- */
const sampleSel=document.getElementById('sampleSel');
if(location.protocol==='file:' || typeof SAMPLE_DB==='undefined' || !SAMPLE_DB.length){
  sampleSel.style.display='none';
}else{
  for(const s of SAMPLE_DB){
    const o=document.createElement('option');
    o.value=s.file; o.textContent=`${s.ko} (${Math.round(s.kb/100)/10}MB)`;
    sampleSel.appendChild(o);
  }
  sampleSel.onchange=async ()=>{
    const f=sampleSel.value; if(!f) return;
    sampleSel.value='';
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
}

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

/* --- 부트: 데모 리플레이 --- */
if(typeof DEMO_REPLAY!=='undefined' && DEMO_REPLAY) load(DEMO_REPLAY);
requestAnimationFrame(tick);
