(() => {
  'use strict'; const canvas=document.querySelector('#game'),ctx=canvas.getContext('2d'); const W=420,H=720, origin= {
    x:210,y:83
  }
  , R=5, TOTAL=24; const pixelRatio = Math.min(window.devicePixelRatio || 1, 3); canvas.width = W * pixelRatio; canvas.height = H * pixelRatio; ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); const $=s=>document.querySelector(s); let blocks=[],balls=[],particles=[],returning=[],score=0,best=0,shot=0,queued=0,clock=0,shotAge=0,paused=false,speed=1,aim=null,dragging=false,mode='ready'; try {
    best=Number(localStorage.getItem('falling-ballz-best'))||0
  }
  catch {
  }
  function color(hp) {
    const stops=[[1,53],[12,45],[30,112],[48,155],[70,255],[100,285]];let hue=285;for(let i=1;i<stops.length;i++) {
      if(hp<=stops[i][0]) {
        let a=stops[i-1],b=stops[i],t=Math.max(0,(hp-a[0])/(b[0]-a[0]));hue=a[1]+(b[1]-a[1])*t;break
      }
    }
    return `hsl(${hue} 94% 64%)`
  }
  function reset() {
    blocks=[['circle',67,236,23,2,0],['square',211,242,25,32,-.14],['triangle',328,285,27,18,.35],['triangle',168,367,29,5,1.45],['circle',66,454,24,72,0],['square',292,448,27,48,.36],['circle',77,564,25,38,0],['triangle',278,572,30,37,0],['square',168,638,24,12,-.3]].map(([type,x,y,r,hp,angle],id)=>( {
      id,type,x,y,r,hp,angle,flash:0
    }
    ));balls=[];returning=[];particles=[];score=shot=queued=clock=0;mode='ready';paused=false;aim=null;$('#overlay').hidden=true;$('#pause').textContent='Ⅱ';hud()
  }
  function hud() {
    $('#score').textContent=score;$('#best').textContent=best;$('#status').textContent=mode==='ready'?'按住拖动瞄准 · 松开发射':mode==='won'?'全部清空！点击 ↻ 再来一局':`第 ${shot} 轮 · 已回收 ${TOTAL-balls.length-queued} / ${TOTAL}`
  }
  function vertices(b) {
    const n=b.type==='triangle'?3:4;return Array.from( {
      length:n
    }
    ,(_,i)=> {
      const a=b.angle+(b.type==='triangle'?-Math.PI/2:Math.PI/4)+i*Math.PI*2/n;const r=b.type==='square'?b.r*1.414:b.r;return {
        x:b.x+Math.cos(a)*r,y:b.y+Math.sin(a)*r
      }
    }
    )
  }
  function hit(ball,b) {
    let nx,ny,depth;if(b.type==='circle') {
      let dx=ball.x-b.x,dy=ball.y-b.y,d=Math.hypot(dx,dy);if(d>=b.r+R)return false;nx=dx/(d||1);ny=dy/(d||1);depth=b.r+R-d
    }
    else {
      const vs=vertices(b);let dist=Infinity,px=0,py=0,inside=true;for(let i=0;i<vs.length;i++) {
        let a=vs[i],c=vs[(i+1)%vs.length],ex=c.x-a.x,ey=c.y-a.y;if(ex*(ball.y-a.y)-ey*(ball.x-a.x)<0)inside=false;let t=Math.max(0,Math.min(1,((ball.x-a.x)*ex+(ball.y-a.y)*ey)/(ex*ex+ey*ey)));let x=a.x+t*ex,y=a.y+t*ey,d=Math.hypot(ball.x-x,ball.y-y);if(d<dist) {
          dist=d;px=x;py=y
        }
      }
      if(!inside&&dist>=R)return false;nx=(ball.x-px)/(dist||1);ny=(ball.y-py)/(dist||1);if(inside) {
        nx=-nx;ny=-ny
      }
      depth=inside?R+dist:R-dist
    }
    ball.x+=nx*(depth+.1);ball.y+=ny*(depth+.1);const dot=ball.vx*nx+ball.vy*ny;if(dot>=0)return false;ball.vx-=2*dot*nx;ball.vy-=2*dot*ny;return true
  }
  function launch() {
    if(mode!=='ready'||!aim||paused)return;shot++;queued=TOTAL;clock=0;shotAge=0;mode='shooting';hud()
  }
  function update(dt) {
    if(paused)return;dt*=speed;for(const b of blocks)b.flash=Math.max(0,b.flash-dt*5);particles=particles.filter(p=> {
      p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;return p.life>0
    }
    );returning=returning.filter(p=> {
      p.t+=dt*1.7;return p.t<1
    }
    );if(mode!=='shooting')return;clock-=dt;shotAge+=dt;while(queued>0&&clock<=0) {
      balls.push( {
        x:origin.x,y:origin.y,vx:aim.x*340,vy:aim.y*340
      }
      );queued--;clock+=.065
    }
    const steps=4;for(let k=0;k<steps;k++) {
      for(const ball of balls) {
        ball.x+=ball.vx*dt/steps;ball.y+=ball.vy*dt/steps;if(ball.x<12+R) {
          ball.x=12+R;ball.vx=Math.abs(ball.vx)
        }
        if(ball.x>W-12-R) {
          ball.x=W-12-R;ball.vx=-Math.abs(ball.vx)
        }
        if(ball.y<100+R) {
          ball.y=100+R;ball.vy=Math.abs(ball.vy)
        }
        for(const b of blocks) {
          if(b.hp>0&&hit(ball,b)) {
            b.hp--;b.flash=1;score++;if(!b.hp)for(let j=0;j<15;j++) {
              const a=j/15*Math.PI*2;particles.push( {
                x:b.x,y:b.y,vx:Math.cos(a)*65,vy:Math.sin(a)*65,life:.45,color:color(1)
              }
              )
            }
          }
        }
      }
      balls=balls.filter(b=> {
        if(b.y>H-30||shotAge>20) {
          returning.push( {
            x:b.x,t:0
          }
          );return false
        }
        return true
      }
      );blocks=blocks.filter(b=>b.hp>0)
    }
    if(score>best) {
      best=score;try {
        localStorage.setItem('falling-ballz-best',best)
      }
      catch {
      }
    }
    if(!queued&&!balls.length&&!returning.length) {
      mode=blocks.length?'ready':'won';aim=null
    }
    hud()
  }
  function path(points) {
    ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath()
  }
  function draw() {
    ctx.clearRect(0,0,W,H);ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);ctx.lineWidth=1.5;ctx.strokeStyle='#353b3d';ctx.beginPath();ctx.moveTo(12,H-34);ctx.lineTo(12,14);ctx.quadraticCurveTo(12,0,28,7);ctx.lineTo(182,65);ctx.quadraticCurveTo(194,70,194,84);ctx.moveTo(226,84);ctx.quadraticCurveTo(226,70,238,65);ctx.lineTo(392,7);ctx.quadraticCurveTo(408,0,408,14);ctx.lineTo(408,H-34);ctx.stroke();ctx.setLineDash([5,6]);ctx.strokeStyle='#292f31';ctx.beginPath();ctx.moveTo(13,99);ctx.lineTo(407,99);ctx.stroke();ctx.setLineDash([]); ctx.fillStyle='#1b2021';ctx.beginPath();ctx.ellipse(210,H+46,290,77,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#3d4446';ctx.stroke(); let waiting=mode==='shooting'?queued:TOTAL;for(let i=0;i<Math.min(waiting,14);i++) {
      let row=i<7?0:1,index=i%7;ctx.beginPath();ctx.arc(145+index*21+(row?10:0),38+row*20-Math.abs(index-3)*4,9,0,7);ctx.fillStyle='#f5f7f5';ctx.fill()
    }
    ctx.fillStyle='#a1a9a9';ctx.font='10px Helvetica Neue';ctx.textAlign='center';ctx.fillText(`× ${TOTAL}`,210,16); for(const b of blocks) {
      ctx.fillStyle=b.flash>.5?'#fff':color(b.hp);if(b.type==='circle') {
        ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,7)
      }
      else path(vertices(b));ctx.fill();ctx.fillStyle='#101616';ctx.font='500 21px Helvetica Neue';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(b.hp,b.x,b.y+1)
    }
    if(aim&&mode==='ready') {
      ctx.save();ctx.setLineDash([1,13]);ctx.lineCap='round';ctx.lineWidth=3;ctx.strokeStyle='#ffffff99';ctx.beginPath();ctx.moveTo(origin.x,origin.y);ctx.lineTo(origin.x+aim.x*185,origin.y+aim.y*185);ctx.stroke();ctx.restore()
    }
    ctx.fillStyle='#fff';if(mode==='ready') {
      ctx.beginPath();ctx.arc(origin.x,origin.y,9,0,7);ctx.fill()
    }
    for(const b of balls) {
      ctx.beginPath();ctx.arc(b.x,b.y,R,0,7);ctx.fill()
    }
    for(const p of returning) {
      const x=p.x+(origin.x-p.x)*p.t,y=(H-22)*(1-p.t)+origin.y*p.t;ctx.fillStyle='#c7ff9380';ctx.beginPath();ctx.arc(x,y,3,0,7);ctx.fill()
    }
    for(const p of particles) {
      ctx.globalAlpha=Math.max(0,p.life/.45);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,3,3)
    }
    ctx.globalAlpha=1;ctx.textBaseline='alphabetic';
  }
  function point(e) {
    const r=canvas.getBoundingClientRect();return {
      x:(e.clientX-r.left)/r.width*W,y:(e.clientY-r.top)/r.height*H
    }
  }
  function setAim(e) {
    const p=point(e),dx=p.x-origin.x,dy=Math.max(35,p.y-origin.y),len=Math.hypot(dx,dy);aim= {
      x:dx/len,y:dy/len
    }
  }
  canvas.addEventListener('pointerdown',e=> {
    if(mode!=='ready'||paused)return;dragging=true;canvas.setPointerCapture(e.pointerId);setAim(e)
  }
  );canvas.addEventListener('pointermove',e=> {
    if(dragging)setAim(e)
  }
  );canvas.addEventListener('pointerup',()=> {
    if(dragging) {
      dragging=false;launch()
    }
  }
  );canvas.addEventListener('pointercancel',()=> {
    if(dragging) {
      dragging=false;aim=null
    }
  }
  ); function togglePause() {
    paused=!paused;$('#overlay').hidden=!paused;$('#pause').textContent=paused?'▷':'Ⅱ'
  }
  $('#pause').onclick=togglePause;$('#resume').onclick=togglePause;$('#speed').onclick=()=> {
    speed=speed===1?2:1;$('#speed').textContent=speed+'×'
  }
  ;$('#reset').onclick=reset;document.addEventListener('keydown',e=> {
    if(e.code==='Space') {
      e.preventDefault();togglePause()
    }
    if(e.key==='f') {
      if(document.fullscreenElement)document.exitFullscreen();else document.querySelector('.game').requestFullscreen?.()
    }
  }
  ); window.render_game_to_text=()=>JSON.stringify( {
    coordinates:'420x720; origin top-left; x right, y down',mode,paused,speed,score,best,shot,queued,returned:TOTAL-queued-balls.length,balls:balls.map(b=>( {
      x:Math.round(b.x),y:Math.round(b.y),vx:Math.round(b.vx),vy:Math.round(b.vy)
    }
    )),blocks:blocks.map(( {
      id,type,x,y,hp,angle
    }
    )=>( {
      id,type,x,y,hp,angle
    }
    ))
  }
  );window.advanceTime=ms=> {
    for(let i=0;i<Math.ceil(ms/(1000/120));i++)update(ms/1000/Math.ceil(ms/(1000/120)));draw()
  }
  ;let last=performance.now();function frame(t) {
    update(Math.min((t-last)/1000,.033));last=t;draw();requestAnimationFrame(frame)
  }
  reset();requestAnimationFrame(frame);
}
)();
