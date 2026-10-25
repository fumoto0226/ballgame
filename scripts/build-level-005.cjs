// Rebuild: node scripts/build-level-005.cjs
const fs=require('node:fs');global.window=global;require('../js/block-geometry.js');
const G=BlockGeometry,blocks=[],layers=[];
const shape=b=>({...b,x:b.dx,y:b.dy,angle:b.baseAngle,r:G.radius(b.type)});
const point=(x,y,type='circle',angle=0)=>({x,y,type,angle});
function rings(){const a=[];for(const [r,n]of [[140,14],[76,7]])for(let i=0;i<n;i++){const t=i/n*Math.PI*2;a.push(point(r*Math.sin(t),-r*Math.cos(t)));}a.push(point(0,0));return a;}
function lattice(){const a=[];for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)if(Math.hypot(x*62,y*62)<=146)a.push(point(x*62,y*62,'square'));return a;}
function twin(){const a=[];for(const cx of [-85,85]){for(let i=0;i<8;i++){const t=i/8*Math.PI*2;a.push(point(cx+62*Math.sin(t),62*Math.cos(t)));}a.push(point(cx,0));}return a;}
function islands(){const a=[];for(const [cx,cy]of [[-72,-72],[72,72],[-72,72],[72,-72]])for(const [dx,dy]of [[-30,-30],[30,-30],[-30,30],[30,30]])a.push(point(cx+dx,cy+dy,'square',0));return a;}
function dense(){const a=[];for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)a.push(point(x*38.2,y*38.2,'square'));return a;}
function orbit(){const a=[];for(let i=0;i<15;i++){const t=i/15*Math.PI*2;a.push(point(140*Math.sin(t),-140*Math.cos(t),'circle'));}for(const [x,y]of [[-60,-30],[0,30],[60,-30]])a.push(point(x,y,'triangle'));return a;}
const recipes=[
 ['双环探路',rings],['交错补给',lattice],['双堡取舍',twin],['偏心四岛',islands],['留白星轨',orbit],['密墙爆破',dense],
 ['双环危机',rings],['交错回响',lattice],['双堡取舍Ⅱ',twin],['偏心四岛Ⅱ',islands],['留白星轨Ⅱ',orbit],['密墙爆破Ⅱ',dense],
 ['双环绝境',rings],['交错终局',lattice],['双堡取舍Ⅲ',twin],['偏心四岛Ⅲ',islands],['留白星轨Ⅲ',orbit],['最终砖墙',dense]];
const health=[9,14,18,30,42,65,110,150,220,330,460,650,750,1000,1400,1900,2500,2500];
// True contact graph: bridge only uncovered points by adding a covering brick above.
// A bridge stays in that band's layout and never overlaps another brick in the same band.
for(let l=0;l<18;l++){
 const list=recipes[l][1]().map(p=>({id:0,type:p.type,tier:'medium',layerFloor:1,dx:p.x,dy:p.y,baseAngle:p.angle,hp:health[l],bonus:false,rewardType:'attempts',rewardAmount:1,coveredBy:[],designLayer:l+1}));
 layers.push(list);
}
// Populate missing cover footprints backwards, so every authored band remains protected.
for(let l=16;l>=0;l--)for(const lower of layers[l+1]){
 if(layers[l].some(b=>G.overlaps(shape(b),shape(lower))))continue;
 const candidates=[point(lower.dx,lower.dy),...Array.from({length:24},(_,i)=>{const t=i*Math.PI/12;return point(lower.dx+24*Math.cos(t),lower.dy+24*Math.sin(t));})];
 const p=candidates.find(p=>Math.hypot(p.x,p.y)<163&&!layers[l].some(b=>G.overlaps(shape(b),{...p,r:20})));
 if(p)layers[l].push({id:0,type:'circle',tier:'medium',layerFloor:1,dx:p.x,dy:p.y,baseAngle:0,hp:health[l],bonus:false,rewardType:'attempts',rewardAmount:1,coveredBy:[],designLayer:l+1});
}
let id=0;for(let l=0;l<18;l++){
 const list=layers[l];for(const b of list)b.id=id++;
 const reward=(kind,amount,hp,x,y)=>{const b=list.filter(b=>!b.bonus).sort((a,b)=>Math.hypot(a.dx-x,a.dy-y)-Math.hypot(b.dx-x,b.dy-y))[0];Object.assign(b,{bonus:true,rewardType:kind,rewardAmount:amount,hp:kind.startsWith('buff-')?amount:hp});return b;};
 if(l===0)reward('buff-lightning',5,5,75,-110);
 const cycle=Math.floor(l/6),charges=[10,24,48][cycle];
 if(l%6===1){reward('attempts',1,Math.ceil(health[l]*.35),0,-125);reward('balls',cycle?16:8,Math.ceil(health[l]*.4),0,0);reward('buff-size',charges,charges,-65,60);}
 if(l%6===2){
  const group='choice-'+cycle;
  const a=reward('balls-multiply',2,Math.ceil(health[l]*.6),-85,0),b=reward('buff-explosive',charges*2,charges*2,85,0);
  a.choiceGroup=b.choiceGroup=group;
  for(const wall of list)if(!wall.choiceGroup)wall.choiceGate=group;
 }
 if(l%6===3){reward('buff-vitality',charges,charges,75,-75);reward('buff-lightning',charges,charges,-75,75);reward('bumper',1,Math.ceil(health[l]*.35),75,75);}
 if(l%6===4){reward('attempts',1,Math.ceil(health[l]*.25),0,-140);reward('balls-multiply',1.5,Math.ceil(health[l]*.3),0,30);reward('buff-explosive',charges,charges,-65,-30);}
 if(l===17)reward('attempts',1,375,0,0);
 if(l%6===5){reward('buff-size',charges,charges,0,-75);reward('buff-lightning',charges,charges,75,0);reward('bumper',1,Math.ceil(health[l]*.25),-75,0);}
 for(const b of list){b.dx=+b.dx.toFixed(4);b.dy=+b.dy.toFixed(4);b.baseAngle=+b.baseAngle.toFixed(4);b.coveredBy=l?layers[l-1].filter(u=>G.overlaps(shape(b),shape(u))).map(u=>u.id):[];}
 blocks.push(...list);
}
const graph=new Map(blocks.map(b=>[b.id,b])),memo=new Map();function depth(b){if(!memo.has(b.id))memo.set(b.id,1+Math.max(0,...b.coveredBy.map(id=>depth(graph.get(id)))));return memo.get(b.id);}
let conflicts=[];for(const list of layers)for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++)if(G.overlaps(shape(list[i]),shape(list[j])))conflicts.push([list[i].id,list[j].id]);
if(conflicts.length)throw Error('overlaps '+JSON.stringify(conflicts));
console.log({count:blocks.length,depth:Math.max(...blocks.map(depth)),HP:blocks.reduce((s,b)=>s+b.hp,0),orphans:blocks.filter(b=>b.designLayer>1&&!b.coveredBy.length).length,counts:layers.map(l=>l.length)});
const level={version:3,revision:3,title:'破局 · 回响',initialAttempts:3,ballCounts:[[8,0,0],[0,0,0],[0,0,0],[0,0,0]],bumpers:[18],designLayers:layers.map((l,i)=>({layer:i+1,pattern:recipes[i][0],count:l.length,hp:health[i]}))};
fs.writeFileSync('js/levels/005.js','// Generated by scripts/build-level-005.cjs; saved levels take precedence.\nwindow.BuiltinLevels=Object.assign(window.BuiltinLevels||{}, {"005":{\n'+JSON.stringify(level,null,2).slice(1,-1)+',\n"blocks":[\n'+blocks.map(b=>JSON.stringify(b)).join(',\n')+'\n]}});\n');
