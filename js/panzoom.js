/* ================= 팬 / 줌 =================
   #world 전체를 CSS transform 으로 움직인다. 핀은 화면 크기를 유지하도록
   1/z 로 역보정한다. */
let z=1, ox=0, oy=0;
function apply(){
  world.style.transform="translate("+ox+"px,"+oy+"px) scale("+z+")";
  document.getElementById('zv').textContent=Math.round(z*100)+"%";
  ST.objs.forEach(o=>{ if(o.type==='pin') o.el.style.transform="scale("+(1/z)+")"; });
}
function fitZ(){ return Math.min(stage.clientWidth/CW, stage.clientHeight/CH)*0.98; }
function fit(){
  z=fitZ();
  ox=(stage.clientWidth-CW*z)/2; oy=(stage.clientHeight-CH*z)/2;
  apply();
}
document.getElementById('zi').onclick=()=>{z*=1.25;apply();};
document.getElementById('zo').onclick=()=>{z/=1.25;apply();};
document.getElementById('fitb').onclick=fit;
stage.addEventListener('wheel',function(e){
  if(e.target.closest('#tbar')||e.target.closest('#tgl')||e.target.closest('#zbar'))return;
  e.preventDefault();
  const r=stage.getBoundingClientRect();
  const mx=e.clientX-r.left, my=e.clientY-r.top;
  const k=e.deltaY<0?1.15:1/1.15;
  ox=mx-(mx-ox)*k; oy=my-(my-oy)*k; z*=k; apply();
},{passive:false});

const vpts=new Map(); let vdrag=null, vpinch=null, lastTap=0;
function vmid(){const a=[...vpts.values()];
  return {x:(a[0].x+a[1].x)/2, y:(a[0].y+a[1].y)/2,
          d:Math.hypot(a[0].x-a[1].x, a[0].y-a[1].y)};}
stage.addEventListener('pointerdown',function(e){
  if(e.target.closest('#zbar')||e.target.closest('#tgl')||e.target.closest('#tbar')||e.target.closest('#trash'))return;
  vpts.set(e.pointerId,{x:e.clientX,y:e.clientY});
  stage.setPointerCapture(e.pointerId);
  if(vpts.size===2){ const m=vmid(); const r=stage.getBoundingClientRect();
    vpinch={d:m.d, x:m.x-r.left, y:m.y-r.top, z:z, ox:ox, oy:oy}; vdrag=null; return; }
  if(vpts.size===1){
    vdrag={x:e.clientX,y:e.clientY,ox:ox,oy:oy}; stage.classList.add('drag');
    const now=Date.now();
    if(now-lastTap<300){ const r=stage.getBoundingClientRect();
      const mx=e.clientX-r.left, my=e.clientY-r.top;
      const k=z<fitZ()*1.8?2.5:1/2.5;
      ox=mx-(mx-ox)*k; oy=my-(my-oy)*k; z*=k; apply(); }
    lastTap=now;
  }
});
stage.addEventListener('pointermove',function(e){
  if(!vpts.has(e.pointerId))return;
  vpts.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(vpinch&&vpts.size>=2){
    const m=vmid(); const k=m.d/(vpinch.d||1);
    z=vpinch.z*k;
    ox=vpinch.x-(vpinch.x-vpinch.ox)*k; oy=vpinch.y-(vpinch.y-vpinch.oy)*k;
    apply(); return;
  }
  if(!vdrag)return; ox=vdrag.ox+(e.clientX-vdrag.x); oy=vdrag.oy+(e.clientY-vdrag.y); apply();
});
function vEnd(e){ vpts.delete(e.pointerId);
  if(vpts.size<2) vpinch=null;
  if(vpts.size===0){ vdrag=null; stage.classList.remove('drag'); } }
stage.addEventListener('pointerup',vEnd);
stage.addEventListener('pointercancel',vEnd);
window.addEventListener('resize',fit);
