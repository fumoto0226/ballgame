(() => {
  function bounds(blocks) {
    const points=blocks.flatMap(b=>b.type==='circle'?[{x:b.x-b.r,y:b.y-b.r},{x:b.x+b.r,y:b.y+b.r}]:BlockGeometry.vertices(b));
    const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x));
    const top=Math.min(...points.map(p=>p.y)),bottom=Math.max(...points.map(p=>p.y));
    return {left,right,top,bottom,cx:(left+right)/2,cy:(top+bottom)/2};
  }
  function snap(moving, others, tolerance=5) {
    const refs=others.map(b=>bounds([b])), guides=[];let dx=0,dy=0;
    for(const axis of ['x','y']) {
      const keys=axis==='x'?['left','cx','right']:['top','cy','bottom'];
      const cross=axis==='x'?'cy':'cx',lo=keys[0],hi=keys[2];
      let best=null;
      const offer=(delta,guide)=>{if(Math.abs(delta)<=tolerance&&(!best||Math.abs(delta)<Math.abs(best.delta)))best={delta,guide};};
      for(const ref of refs) for(const a of keys) for(const b of keys)offer(ref[b]-moving[a],{type:'align',axis,value:ref[b],from:Math.min(moving[cross],ref[cross])-30,to:Math.max(moving[cross],ref[cross])+30});
      const sorted=[...refs].sort((a,b)=>a[lo]-b[lo]);
      for(let i=0;i<sorted.length-1;i++) {
        const a=sorted[i],b=sorted[i+1],gap=b[lo]-a[hi];
        if(gap<0||Math.abs(a[cross]-b[cross])>5||Math.abs(moving[cross]-b[cross])>20)continue;
        const pos=(a[cross]+b[cross])/2;
        offer(b[hi]+gap-moving[lo],{type:'gap',axis,gap,position:pos,segments:[[a[hi],b[lo]],[b[hi],b[hi]+gap]]});
        offer(a[lo]-gap-moving[hi],{type:'gap',axis,gap,position:pos,segments:[[a[lo]-gap,a[lo]],[a[hi],b[lo]]]});
      }
      if(best){if(axis==='x')dx=best.delta;else dy=best.delta;guides.push(best.guide);}
    }
    return {dx,dy,guides};
  }
  function draw(ctx,guides){
    ctx.save();ctx.strokeStyle='#e782c7';ctx.fillStyle='#f2abe0';ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.font='10px sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';
    for(const g of guides){
      if(g.type==='align'){ctx.beginPath();if(g.axis==='x'){ctx.moveTo(g.value,g.from);ctx.lineTo(g.value,g.to);}else{ctx.moveTo(g.from,g.value);ctx.lineTo(g.to,g.value);}ctx.stroke();}
      else for(const [a,b]of g.segments){ctx.beginPath();if(g.axis==='x'){ctx.moveTo(a,g.position);ctx.lineTo(b,g.position);ctx.stroke();ctx.fillText(`${+g.gap.toFixed(1)}`,(a+b)/2,g.position-4);}else{ctx.moveTo(g.position,a);ctx.lineTo(g.position,b);ctx.stroke();ctx.fillText(`${+g.gap.toFixed(1)}`,g.position+12,(a+b)/2);} }
    }ctx.restore();
  }
  window.EditorGuides={bounds,snap,draw};
})();
