/* ================= 배경 맵 =================
   MAP_DB(js/data_maps.js)의 SVG 를 <img> 로 불러와 캔버스에 깐다.
   file:// 로 열어도 동작하도록 fetch 를 쓰지 않는다.
   cal(월드범위)은 매니페스트 값으로 자동 설정되고, 수동으로 미세 조정할 수 있다. */
let bgAutoCal=null;
let curMapSlug=null;

const mapSel=document.getElementById('mapSel');
(function buildMapSel(){
  const opt=(v,t)=>{const o=document.createElement('option');o.value=v;o.textContent=t;return o;};
  mapSel.appendChild(opt('','배경 맵 선택 ▾'));
  const g1=document.createElement('optgroup'); g1.label='정식 전장';
  const g2=document.createElement('optgroup'); g2.label='무작위 난투';
  for(const m of MAP_DB) (m.brawl?g2:g1).appendChild(opt(m.slug,m.ko));
  mapSel.appendChild(g1); mapSel.appendChild(g2);
})();
mapSel.onchange=()=>{ if(mapSel.value) loadMapBySlug(mapSel.value); };

/* 리플레이의 맵 이름(한/영, 샌드박스 표기 포함) -> MAP_DB 항목 */
function mapNorm(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9가-힣]/g,''); }
function matchMap(name){
  const n=mapNorm(name);
  if(!n) return null;
  for(const m of MAP_DB) if(n===mapNorm(m.ko)||n===mapNorm(m.en)) return m;
  for(const m of MAP_DB) if(n.includes(mapNorm(m.ko))||n.includes(mapNorm(m.en))) return m;
  return null;
}

const loadingEl=document.getElementById('loading');
function showLoading(t){ loadingEl.textContent=t; loadingEl.classList.add('show'); }
function hideLoading(){ loadingEl.classList.remove('show'); }

function loadMapBySlug(slug){
  const m=MAP_DB.find(x=>x.slug===slug);
  if(!m) return;
  curMapSlug=slug; mapSel.value=slug;
  showLoading('맵 불러오는 중… '+m.ko);
  const img=new Image();
  img.onload=()=>{
    if(curMapSlug!==slug) return;          // 그 사이 다른 맵을 골랐다
    bgImg=img;
    bgAutoCal={L:m.cal.L,R:m.cal.R,B:m.cal.B,T:m.cal.T};
    if(G){ cal={...bgAutoCal}; syncCalInputs(); }
    hideLoading(); markDirty();
    setStatus('배경: '+m.ko+' — 구조물 마커와 어긋나면 배경 월드범위로 미세 조정');
  };
  img.onerror=()=>{ hideLoading(); setStatus('맵 파일을 읽지 못했습니다: '+m.file); };
  img.src=m.file;
}

/* --- 직접 올린 배경 (SVG/PNG) --- */
function applyBg(url, mapW, mapH, label){
  const img=new Image();
  img.onload=()=>{ bgImg=img;
    if(mapW && mapH){ bgAutoCal={L:0,R:mapW,B:0,T:mapH};
      if(G){ cal={...bgAutoCal}; syncCalInputs(); }
      setStatus(`배경 자동 정렬됨: ${label??''} (${mapW}×${mapH})`); }
    else setStatus('구조물 마커가 배경의 건물과 겹치도록 X/Y 범위를 조절하세요');
    markDirty(); };
  img.onerror=()=>alert('이미지를 읽지 못했습니다');
  img.src=url;
}
function svgDims(text){
  const w=text.match(/data-map-w="([\d.]+)"/), h=text.match(/data-map-h="([\d.]+)"/);
  if(w&&h) return [parseFloat(w[1]), parseFloat(h[1])];
  const vb=text.match(/viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+) ([\d.]+)"/);
  return vb? [parseFloat(vb[1]), parseFloat(vb[2])] : [null,null];
}
document.getElementById('bgfile').onchange=async ev=>{
  const f=ev.target.files[0]; if(!f)return;
  curMapSlug=null; mapSel.value='';
  if(/\.svg$/i.test(f.name)){
    const text=await f.text();
    const [w,h]=svgDims(text);
    applyBg(URL.createObjectURL(new Blob([text],{type:'image/svg+xml'})), w, h, f.name);
  } else { bgAutoCal=null; applyBg(URL.createObjectURL(f), null, null, f.name); }
};
