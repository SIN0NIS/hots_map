/* ================= 전술 도구 (펜 · 지우개 · 핀 · 토큰 · 이미지) ================= */
const tbar=document.getElementById('tbar'), tgl=document.getElementById('tgl'), trash=document.getElementById('trash');
let toolOn=false, mode='pan', penSz=6, tokSz=44, color='#ff4d4d';
const COLORS=['#ff4d4d','#4da3ff','#ffd24d','#5dde7a','#c07bff','#ffffff','#14181f'];
const TEAMC={blue:'#3b82f6',red:'#e5484d'};
let team='blue', heroSel=null;            // heroSel: null=기본, {name,src}
const cnt={blue:0,red:0};
const ST={objs:[],strokes:[],hist:[]};    // 단일 상태 (현재 보드)
let selObj=null, act=null, tpinch=null;
const tp=new Map();

/* --- 판서 --- */
function strokePath(c,s){
  c.globalCompositeOperation=(s.m==='ers')?'destination-out':'source-over';
  c.strokeStyle=c.fillStyle=s.color; c.lineWidth=s.w;
  if(s.pts.length<2){
    c.beginPath(); c.arc(s.pts[0][0],s.pts[0][1],s.w/2,0,7); c.fill();
  }else{
    c.beginPath(); c.moveTo(s.pts[0][0],s.pts[0][1]);
    for(let i=1;i<s.pts.length;i++) c.lineTo(s.pts[i][0],s.pts[i][1]);
    c.stroke();
  }
  c.globalCompositeOperation='source-over';
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
 pan:'빈 곳 끌기=맵 이동 · 말/핀은 끌어서 이동, 🗑에 놓으면 삭제',
 pen:'끌어서 그리기 · 말은 ✋에서 이동',
 ers:'문질러서 지우기',
 pin:'탭=핀 추가 · 영웅을 고르면 영웅 핀, ●이면 색 핀',
 tok:'팀·영웅 고르고 탭=배치 · 끌기=맵 이동'};
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
  setSlider();
}
document.querySelectorAll('.it[data-m]').forEach(b=>b.onclick=()=>setMode(b.dataset.m));
tgl.onclick=()=>{
  toolOn=!toolOn;
  tgl.classList.toggle('on',toolOn);
  tbar.classList.toggle('on',toolOn);
  document.body.classList.toggle('objmove',toolOn&&mode!=='pen'&&mode!=='ers');
  if(!toolOn){ selectObj(null); act=null; tp.clear(); tpinch=null; trash.className=''; }
};
function selectObj(o){
  if(selObj) selObj.el.classList.remove('sel');
  selObj=o;
  if(o){
    o.el.classList.add('sel');
    if(mode==='tok'&&o.s){ szEl.value=o.s; szv.textContent=o.s; }
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
    el.style.background='#0e1116'; el.title=o.hero;
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
  if(o.type!=='pin') selectObj(o);
  act={kind:'obj',id:e.pointerId,o,dx:o.x-p.x,dy:o.y-p.y};
  trash.classList.add('show');
}
document.addEventListener('pointerdown',function(e){
  if(!toolOn) return;
  if(!stage.contains(e.target)) return;
  if(e.target.closest('#zbar')||e.target.closest('#tbar')||e.target.closest('#tgl')) return;
  const p=mapPt(e), o=hit(p);
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
    const last=act.s.pts[act.s.pts.length-1];
    dctx.globalCompositeOperation=(act.s.m==='ers')?'destination-out':'source-over';
    dctx.strokeStyle=act.s.color; dctx.lineWidth=act.s.w;
    dctx.beginPath(); dctx.moveTo(last[0],last[1]); dctx.lineTo(p.x,p.y); dctx.stroke();
    dctx.globalCompositeOperation='source-over';
    act.s.pts.push([p.x,p.y]);
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
setMode('pan');
