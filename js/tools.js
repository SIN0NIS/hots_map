/* ================= 전술 도구 (펜 · 지우개 · 핀 · 토큰 · 이미지) ================= */
const tbar=document.getElementById('tbar'), tgl=document.getElementById('tgl'), trash=document.getElementById('trash');
let toolOn=false, mode='pan', penSz=6, tokSz=44, color='#ff4d4d';
const COLORS=['#ff4d4d','#339fee','#ffd24d','#5dde7a','#c07bff','#ffffff','#14181f'];
const TEAMC={blue:'#339fee',red:'#e64343'};   // css/style.css 의 --blue/--red 와 같은 색
let team='blue', heroSel=null;            // heroSel: null=기본, {name,src}
const cnt={blue:0,red:0};
const ST={objs:[],strokes:[],hist:[]};    // 단일 상태 (현재 보드)
let selObj=null, act=null, tpinch=null;
const tp=new Map();

/* --- 판서 --- */
/* 밝은 지도 위에서도 선이 보이도록 검은 테두리를 먼저 깔고 그 위에 색을 얹는다 */
const OUTLINE='#0b0e13';
function strokeOne(c,s,color,w){
  c.strokeStyle=c.fillStyle=color; c.lineWidth=w;
  if(s.pts.length<2){
    c.beginPath(); c.arc(s.pts[0][0],s.pts[0][1],w/2,0,7); c.fill();
  }else{
    c.beginPath(); c.moveTo(s.pts[0][0],s.pts[0][1]);
    for(let i=1;i<s.pts.length;i++) c.lineTo(s.pts[i][0],s.pts[i][1]);
    c.stroke();
  }
}
function outlineW(w){ return w + Math.max(2, w*0.55); }
function strokePath(c,s){
  if(s.m==='ers'){
    c.globalCompositeOperation='destination-out';
    strokeOne(c,s,s.color,s.w);
    c.globalCompositeOperation='source-over';
    return;
  }
  strokeOne(c,s,OUTLINE,outlineW(s.w));   // 검은 테두리
  strokeOne(c,s,s.color,s.w);             // 그 위에 색
}
function replayStrokes(){
  dctx.clearRect(0,0,dc.width,dc.height);
  ST.strokes.forEach(s=>strokePath(dctx,s));
}
function delObj(o,record){
  o.el.remove(); ST.objs.splice(ST.objs.indexOf(o),1);
  if(selObj===o) selectObj(null);
  if(record) ST.hist.push({t:'del',o});
}
function undo(){
  if(!ST.hist.length) return;
  const a=ST.hist.pop();
  if(a.t==='stroke'){ ST.strokes.pop(); replayStrokes(); }
  else if(a.t==='add'){ delObj(a.o,false); }
  else if(a.t==='addmany'){ a.objs.forEach(o=>delObj(o,false)); }
  else if(a.t==='del'){ objsEl.appendChild(a.o.el); ST.objs.push(a.o); }
  else if(a.t==='clear'){
    ST.strokes=a.strokes; replayStrokes();
    a.objs.forEach(o=>{ objsEl.appendChild(o.el); ST.objs.push(o); });
  }
}
document.getElementById('undo').onclick=undo;
document.getElementById('clrAll').onclick=()=>{
  if(!ST.strokes.length&&!ST.objs.length) return;
  ST.hist.push({t:'clear',strokes:ST.strokes.slice(),objs:ST.objs.slice()});
  ST.strokes=[]; dctx.clearRect(0,0,dc.width,dc.height);
  ST.objs.forEach(o=>o.el.remove()); ST.objs=[]; selectObj(null);
};

/* --- 툴바 UI --- */
const colorsEl=document.getElementById('colors');
COLORS.forEach(c=>{
  const b=document.createElement('button');
  b.className='cs'+(c===color?' on':'');
  b.style.background=c;
  b.onclick=()=>{ color=c;
    [...colorsEl.children].forEach(x=>x.classList.remove('on'));
    b.classList.add('on'); };
  colorsEl.appendChild(b);
});
const teamRow=document.getElementById('teamrow');
document.querySelectorAll('.teamb').forEach(b=>b.onclick=()=>{
  team=b.dataset.t;
  document.querySelectorAll('.teamb').forEach(x=>x.classList.toggle('on',x===b));
  if(selObj&&selObj.type==='tok') setTokTeam(selObj,team);
});

/* --- 영웅 팔레트: 내장 90명 + 직접 등록 --- */
const heroesEl=document.getElementById('heroes');
const herofile=document.getElementById('herofile');
const hsearch=document.getElementById('hsearch');
const BUILTIN_HEROES = HERO_DB.slice()
  .sort((a,b)=>a.ko.localeCompare(b.ko,'ko'))
  .map(h=>({name:h.ko, en:h.en, src:'icons/'+h.icon}));
const customIcons=[];
function heroBtn(h){
  const b=document.createElement('button');
  b.className='hb'+(heroSel&&heroSel.src===h.src?' on':'');
  b.title=h.en? h.name+' ('+h.en+')' : h.name;
  const im=document.createElement('img');
  im.src=h.src; im.alt=h.name; im.loading='lazy'; im.draggable=false;
  b.appendChild(im);
  b.onclick=()=>{ heroSel=h; renderHeroes(); };
  return b;
}
function renderHeroes(){
  const q=heroNorm(hsearch.value);
  heroesEl.innerHTML='';
  const b0=document.createElement('button');
  b0.className='hb'+(heroSel===null?' on':'');
  b0.textContent='●'; b0.title='기본 (색 핀 / 번호 토큰)';
  b0.onclick=()=>{ heroSel=null; renderHeroes(); };
  heroesEl.appendChild(b0);
  for(const h of BUILTIN_HEROES){
    if(q && !heroNorm(h.name).includes(q) && !heroNorm(h.en).includes(q)) continue;
    heroesEl.appendChild(heroBtn(h));
  }
  for(const h of customIcons){
    if(q && !heroNorm(h.name).includes(q)) continue;
    heroesEl.appendChild(heroBtn(h));
  }
  const ba=document.createElement('button');
  ba.className='hb'; ba.textContent='＋'; ba.title='아이콘 직접 등록 (여러 장 가능)';
  ba.onclick=()=>herofile.click();
  heroesEl.appendChild(ba);
}
hsearch.oninput=renderHeroes;
herofile.onchange=()=>{
  const fs=[...herofile.files]; if(!fs.length) return;
  let left=fs.length;
  fs.forEach(f=>{
    const rd=new FileReader();
    rd.onload=()=>{
      customIcons.push({name:f.name.replace(/\.[^.]+$/,''),src:rd.result});
      if(--left===0){ heroSel=customIcons[customIcons.length-1]; renderHeroes(); }
    };
    rd.readAsDataURL(f);
  });
  herofile.value='';
};
renderHeroes();

/* --- 크기 슬라이더 --- */
const szEl=document.getElementById('sz'), szv=document.getElementById('szv');
const szwrap=document.getElementById('szwrap');
function resizeObj(o,s){
  o.s=s;
  if(o.type==='tok'){
    o.el.style.width=o.el.style.height=s+'px';
    o.el.style.fontSize=Math.round(s*.34)+'px';
    o.el.style.borderWidth=Math.max(2,Math.round(s*.05))+'px';
  }
  if(o.type==='img') o.el.style.width=s+'px';
  if(o.type==='mark'){ o.el.style.width=o.el.style.height=s+'px';
    o.el.style.fontSize=Math.round(s*.72)+'px'; }
}
function setSlider(){
  if(mode==='tok'){ szEl.min=16; szEl.max=400; szEl.value=selObj?selObj.s:tokSz; }
  else { szEl.min=2; szEl.max=40; szEl.value=penSz; }
  szv.textContent=szEl.value;
}
szEl.oninput=()=>{
  szv.textContent=szEl.value;
  if(mode==='tok'){
    tokSz=Math.min(+szEl.value,200);
    if(selObj) resizeObj(selObj,+szEl.value);
  } else penSz=+szEl.value;
};

/* --- 모드 전환 --- */
const HINTS={
 pan:'우클릭=도구 빠른 선택 · V✋ B✏️ E🧽 P📍 T♟ · 말/핀은 끌어서 이동, 🗑에 놓으면 삭제',
 pen:'끌어서 그리기 · 말은 ✋에서 이동',
 ers:'문질러서 지우기',
 pin:'탭=핀 추가 · 영웅을 고르면 영웅 핀, ●이면 색 핀',
 tok:'팀·영웅 고르고 탭=배치 · 끌기=맵 이동'};
/* 지금 «글자를 입력하는 칸»에 포커스가 있나. 태그명만 보면 슬라이더·체크박스를
   한 번 누른 뒤 단축키가 전부 죽는다 (그것들도 INPUT 이라). */
function isTypingTarget(){
  const el=document.activeElement; if(!el) return false;
  if(el.isContentEditable) return true;
  const t=el.tagName;
  if(t==='TEXTAREA'||t==='SELECT') return true;
  if(t!=='INPUT') return false;
  return !/^(range|checkbox|radio|button|submit|reset|file|color|image)$/i.test(el.type);
}
/* 지금 도구를 마우스 커서로 보여준다 (이모지를 SVG 로 감싸 커서로 쓴다) */
const CURSOR_ICON={pen:'✏️',ers:'🧽',pin:'📍',tok:'♟'};
function applyCursor(){
  const ic = toolOn ? CURSOR_ICON[mode] : null;
  if(!ic){ stage.style.cursor=''; return; }
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30">'+
    '<text y="23" font-size="22">'+ic+'</text></svg>';
  // 핀·펜은 «찍는 지점»이 왼쪽 아래, 나머지는 가운데를 기준점으로 둔다
  const hot = (mode==='pen'||mode==='pin') ? '3 26' : '15 15';
  stage.style.cursor=`url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hot}, crosshair`;
}
function setMode(m){
  mode=m;
  document.querySelectorAll('.it[data-m]').forEach(b=>b.classList.toggle('on',b.dataset.m===m));
  colorsEl.style.display=(m==='pen'||m==='pin')?'flex':'none';
  teamRow.style.display=(m==='tok'||m==='pin')?'flex':'none';
  const showHero=(m==='tok'||m==='pin');
  heroesEl.style.display=showHero?'flex':'none';
  hsearch.style.display=showHero?'block':'none';
  szwrap.style.display=(m==='pen'||m==='ers'||m==='tok')?'flex':'none';
  document.getElementById('hint').textContent=HINTS[m];
  document.body.classList.toggle('objmove',toolOn&&m!=='pen'&&m!=='ers');
  setSlider(); applyCursor();
}
// 도구를 고르면 도구도 켠다. 안 그러면 «패널은 열려 있는데 아무것도 안 되는» 상태가 된다.
document.querySelectorAll('.it[data-m]').forEach(b=>b.onclick=()=>{ setToolOn(true); setMode(b.dataset.m); });

/* 도구를 켜고 끈다. 도구 «패널»과는 따로다 — 패널을 닫아도 도구는 계속 쓸 수 있다. */
function setToolOn(on){
  toolOn=on;
  tgl.classList.toggle('on',toolOn);
  document.body.classList.toggle('objmove',toolOn&&mode!=='pen'&&mode!=='ers');
  if(!toolOn){ selectObj(null); act=null; tp.clear(); tpinch=null; trash.className=''; setMode('pan'); }
  applyCursor();
}
function setPanel(open){ tbar.classList.toggle('on',open); }
tgl.onclick=()=>{
  const open=!tbar.classList.contains('on');
  setPanel(open);
  if(open) setToolOn(true);
};
function selectObj(o){
  if(selObj) selObj.el.classList.remove('sel');
  selObj=o;
  if(o){
    o.el.classList.add('sel');
    if(mode==='tok'&&o.type==='tok'&&o.s){ szEl.value=o.s; szv.textContent=o.s; }
  }
}

/* --- 객체 --- */
function place(o){
  o.el.style.left=o.x+'px'; o.el.style.top=o.y+'px';
  if(o.type!=='pin') o.el.style.transform='translate(-50%,-50%)';
}
function setTokTeam(o,t){
  o.team=t;
  o.el.style.borderColor=TEAMC[t];
  if(!o.hero) o.el.style.background=TEAMC[t];
}
function addTok(x,y){
  const el=document.createElement('div');
  el.className='obj tok'; el.style.borderStyle='solid';
  const o={type:'tok',x,y,s:tokSz,team,hero:null,el};
  if(heroSel){
    o.hero=heroSel.name;
    const im=document.createElement('img');
    im.src=heroSel.src; im.draggable=false;
    el.appendChild(im);
    el.style.background='#06101c'; el.title=o.hero;
  }else{
    el.textContent=(team==='blue'?'B':'R')+(++cnt[team]);
  }
  setTokTeam(o,team);
  place(o); resizeObj(o,tokSz);
  objsEl.appendChild(el); ST.objs.push(o);
  ST.hist.push({t:'add',o});
  return o;
}
function addPin(x,y){
  const w=document.createElement('div');
  const o={type:'pin',x,y,el:w};
  if(heroSel){
    // 영웅 핀: 팀색 테두리 원형 아이콘 + 꼬리. 밑동이 (x,y)에 닿는다.
    w.className='obj pinw hero';
    const hp=document.createElement('div'); hp.className='pinh';
    const c=document.createElement('div'); c.className='ph-c';
    c.style.borderColor=TEAMC[team];
    const im=document.createElement('img'); im.src=heroSel.src; im.draggable=false;
    c.appendChild(im);
    const t=document.createElement('div'); t.className='ph-t';
    t.style.borderTopColor=TEAMC[team];
    hp.appendChild(t); hp.appendChild(c);
    w.appendChild(hp);
    w.title=heroSel.name;
    o.hero=heroSel.name; o.team=team;
  }else{
    w.className='obj pinw';
    const b=document.createElement('div'); b.className='pinb'; b.style.background=color;
    w.appendChild(b);
  }
  place(o); w.style.transform='scale('+(1/z)+')';
  objsEl.appendChild(w); ST.objs.push(o);
  ST.hist.push({t:'add',o});
  return o;
}
/* 표식 — 파괴된 구조물처럼 «자리»만 알려 주는 객체.
   토큰과 달리 팀·번호가 없고, 옮기고 지우는 것은 똑같이 된다. */
function addMark(x,y,txt,cls,s){
  const el=document.createElement('div');
  el.className='obj mark '+(cls||'');
  el.textContent=txt||'✕';
  const o={type:'mark',x,y,s:s||34,el};
  el.style.width=el.style.height=o.s+'px';
  el.style.fontSize=Math.round(o.s*.72)+'px';
  place(o); objsEl.appendChild(el); ST.objs.push(o);
  ST.hist.push({t:'add',o});
  return o;
}
function addImg(src,x,y,wpx){
  const el=document.createElement('img');
  el.className='obj imgobj'; el.src=src; el.draggable=false;
  const o={type:'img',x,y,s:wpx,el};
  el.style.width=wpx+'px';
  place(o); objsEl.appendChild(el); ST.objs.push(o);
  ST.hist.push({t:'add',o});
  return o;
}
const imgfile=document.getElementById('imgfile');
document.getElementById('imgbtn').onclick=()=>imgfile.click();
imgfile.onchange=()=>{
  const f=imgfile.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{
    const x=(stage.clientWidth/2-ox)/z, y=(stage.clientHeight/2-oy)/z;
    const o=addImg(rd.result,x,y,300);
    setMode('pan'); selectObj(o);
  };
  rd.readAsDataURL(f);
  imgfile.value='';
};

/* --- 도구 포인터 처리 --- */
function mapPt(e){
  const r=stage.getBoundingClientRect();
  return {x:(e.clientX-r.left-ox)/z, y:(e.clientY-r.top-oy)/z};
}
function hit(p){
  for(let i=ST.objs.length-1;i>=0;i--){
    const o=ST.objs[i];
    if(o.type==='pin'){
      const cy = o.hero? o.y-23/z : o.y-17/z;      // 영웅 핀은 머리가 크고 높다
      const rr = o.hero? 20/z : 20/z;
      if(Math.hypot(p.x-o.x,p.y-cy)<=rr) return o;
    }else if(o.type==='tok'){
      if(Math.hypot(p.x-o.x,p.y-o.y)<=o.s/2+6/z) return o;
    }else{
      const h=(o.el.naturalHeight&&o.el.naturalWidth)?o.s*o.el.naturalHeight/o.el.naturalWidth:o.s;
      if(Math.abs(p.x-o.x)<=o.s/2&&Math.abs(p.y-o.y)<=h/2) return o;
    }
  }
  return null;
}
function overTrash(e){
  const r=trash.getBoundingClientRect();
  return e.clientX>r.left-12&&e.clientX<r.right+12&&e.clientY>r.top-12&&e.clientY<r.bottom+12;
}
function tmid(){
  const a=[...tp.values()];
  return {x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2,d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)};
}
function startObjDrag(o,p,e){
  selectObj(o);
  act={kind:'obj',id:e.pointerId,o,dx:o.x-p.x,dy:o.y-p.y};
  trash.classList.add('show');
}
document.addEventListener('pointerdown',function(e){
  if(!toolOn) return;
  if(!stage.contains(e.target)) return;
  if(e.target.closest('#zbar')||e.target.closest('#tbar')||e.target.closest('#tgl')) return;
  if(e.target.closest('#quickmenu')) return;   // 빠른메뉴는 «도구 대상»이 아니다
  if(qmOpen) closeQuick();                     // 메뉴 밖을 누르면 닫는다
  const p=mapPt(e), o=hit(p);
  if(!o) selectObj(null);        // 맨땅을 누르면 어떤 도구에서든 선택을 푼다
  if(mode==='pan'){
    if(!o) return;
    e.stopPropagation(); e.preventDefault();
    startObjDrag(o,p,e);
    return;
  }
  e.stopPropagation(); e.preventDefault();
  tp.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(tp.size===2&&(mode==='pin'||mode==='tok')){
    if(act&&act.kind!=='obj') act=null;
    if(!act){
      const m=tmid(), r=stage.getBoundingClientRect();
      tpinch={d:m.d,x:m.x-r.left,y:m.y-r.top,z:z,ox:ox,oy:oy};
    }
    return;
  }
  if(act) return;
  if(mode==='pen'||mode==='ers'){
    const w=(mode==='ers'?penSz*3:penSz)/z;
    const s={m:mode,color:color,w:w,pts:[[p.x,p.y]]};
    strokePath(dctx,s);
    act={kind:'draw',id:e.pointerId,s:s};
  }else{
    if(o){ startObjDrag(o,p,e); }
    else act={kind:'tap',id:e.pointerId,sx:e.clientX,sy:e.clientY,ox:ox,oy:oy,p:p};
  }
},true);
document.addEventListener('pointermove',function(e){
  if(!toolOn) return;
  if(tp.has(e.pointerId)) tp.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(tpinch&&tp.size>=2){
    e.stopPropagation(); e.preventDefault();
    const m=tmid(), k=m.d/(tpinch.d||1);
    z=tpinch.z*k;
    ox=tpinch.x-(tpinch.x-tpinch.ox)*k; oy=tpinch.y-(tpinch.y-tpinch.oy)*k;
    apply(); return;
  }
  if(!act||e.pointerId!==act.id) return;
  e.stopPropagation(); e.preventDefault();
  if(act.kind==='draw'){
    const p=mapPt(e);
    act.s.pts.push([p.x,p.y]);
    // 테두리를 같이 그려야 하므로 획 전체를 다시 그린다 (획 하나라 부담 없다)
    if(act.s.m==='ers'){
      const last=act.s.pts[act.s.pts.length-2];
      dctx.globalCompositeOperation='destination-out';
      dctx.strokeStyle=act.s.color; dctx.lineWidth=act.s.w;
      dctx.beginPath(); dctx.moveTo(last[0],last[1]); dctx.lineTo(p.x,p.y); dctx.stroke();
      dctx.globalCompositeOperation='source-over';
    }else{
      replayStrokes(); strokePath(dctx,act.s);
    }
  }else if(act.kind==='obj'){
    const p=mapPt(e);
    act.o.x=p.x+act.dx; act.o.y=p.y+act.dy; place(act.o);
    if(act.o.type==='pin') act.o.el.style.transform='scale('+(1/z)+')';
    trash.classList.toggle('hot',overTrash(e));
  }else if(act.kind==='tap'){
    if(Math.hypot(e.clientX-act.sx,e.clientY-act.sy)>6) act.kind='panning';
  }
  if(act.kind==='panning'){
    ox=act.ox+(e.clientX-act.sx); oy=act.oy+(e.clientY-act.sy); apply();
  }
},true);
function endTool(e){
  if(!toolOn) return;
  tp.delete(e.pointerId);
  if(tp.size<2) tpinch=null;
  if(!act||e.pointerId!==act.id) return;
  e.stopPropagation();
  if(act.kind==='draw'){
    ST.strokes.push(act.s); ST.hist.push({t:'stroke'});
  }else if(act.kind==='obj'){
    if(overTrash(e)) delObj(act.o,true);
    trash.className='';
  }else if(act.kind==='tap'){
    if(mode==='pin') addPin(act.p.x,act.p.y);
    else if(mode==='tok') addTok(act.p.x,act.p.y);
  }
  act=null;
}
document.addEventListener('pointerup',endTool,true);
document.addEventListener('pointercancel',endTool,true);

/* --- 빠른 도구 바꾸기 ---
   지도 위에서 «우클릭» 하면 그 자리에 메뉴가 뜬다. 좌클릭이나 1~5 키로 고르고
   Esc·우클릭으로 닫는다. 도구 패널을 열지 않아도 바로 쓸 수 있다. */
const QUICK=[
  {m:'pan', ic:'✋', ko:'이동/선택'},
  {m:'pen', ic:'✏️', ko:'펜'},
  {m:'ers', ic:'🧽', ko:'지우개'},
  {m:'pin', ic:'📍', ko:'핀'},
  {m:'tok', ic:'♟', ko:'토큰'},
  {m:'clr', ic:'🗑', ko:'모두 지우기', warn:true},
];
const qm=document.createElement('div');
qm.id='quickmenu';
QUICK.forEach((q,i)=>{
  const b=document.createElement('button');
  b.innerHTML=`<b>${i+1}</b><span class="ic">${q.ic}</span><span>${q.ko}</span>`;
  if(q.warn) b.className='warn';
  b.onclick=()=>{ pickQuick(q.m); };
  qm.appendChild(b);
});
stage.appendChild(qm);
let qmOpen=false, lastMouse={x:0,y:0};
stage.addEventListener('pointermove',e=>{ lastMouse={x:e.clientX,y:e.clientY}; });
function pickQuick(m){
  closeQuick();
  if(m==='clr'){ document.getElementById('clrAll').click(); return; }  // Ctrl+Z 로 되돌릴 수 있다
  if(m==='pan'){ setToolOn(false); return; }
  setToolOn(true); setMode(m);
}
function openQuick(){
  const r=stage.getBoundingClientRect();
  const x=Math.min(Math.max(8,lastMouse.x-r.left-60), r.width-150);
  const y=Math.min(Math.max(8,lastMouse.y-r.top-60), r.height-226);
  qm.style.left=x+'px'; qm.style.top=y+'px';
  qm.classList.add('on'); qmOpen=true;
  [...qm.children].forEach((b,i)=>b.classList.toggle('on', QUICK[i].m===(toolOn?mode:'pan')));
}
function closeQuick(){ qm.classList.remove('on'); qmOpen=false; }
stage.addEventListener('pointerdown',e=>{ if(qmOpen && !e.target.closest('#quickmenu')) closeQuick(); },true);
stage.addEventListener('contextmenu',e=>{
  if(e.target.closest('#tbar')||e.target.closest('#zbar')||e.target.closest('#tgl')) return;
  e.preventDefault();
  lastMouse={x:e.clientX,y:e.clientY};
  qmOpen ? closeQuick() : openQuick();
});

window.addEventListener('keydown',e=>{
  if(isTypingTarget()) return;
  if(e.ctrlKey||e.metaKey||e.altKey) return;
  const k=e.key.toLowerCase();
  if(qmOpen){
    const n=parseInt(e.key,10);
    if(n>=1&&n<=QUICK.length){ e.preventDefault(); pickQuick(QUICK[n-1].m); return; }
    // stopImmediatePropagation 이 없으면 main.js 의 Esc(도구 해제)가 이어서 돌아간다
    if(k==='escape'){ e.preventDefault(); e.stopImmediatePropagation(); closeQuick(); return; }
  }
  // 한 글자 단축키 — 패널을 열지 않아도 바로 그 도구가 된다
  const HOT={v:'pan', b:'pen', e:'ers', p:'pin', t:'tok'};
  if(HOT[k]!==undefined){ e.preventDefault(); pickQuick(HOT[k]); }
});

setMode('pan');
