const test=require('node:test');const assert=require('node:assert/strict');global.window=global;require('../js/block-geometry.js');require('../js/editor-guides.js');
test('drag snaps to row and repeats a seven-pixel edge gap',()=>{
 const a={id:0,type:'circle',x:0,y:0,r:10},b={...a,id:1,x:27},moving={...a,id:2,x:55,y:3};
 const result=EditorGuides.snap(EditorGuides.bounds([moving]),[a,b]);assert.equal(result.dx,-1);assert.equal(result.dy,-3);assert.ok(result.guides.some(g=>g.type==='gap'&&g.gap===7));
});
test('distant placement is not snapped and group bounds include every member',()=>{
 const a={type:'circle',x:0,y:0,r:10},b={...a,x:40,y:30};const box=EditorGuides.bounds([a,b]);assert.deepEqual(box,{left:-10,right:50,top:-10,bottom:40,cx:20,cy:15});
 const result=EditorGuides.snap(EditorGuides.bounds([{...a,x:100,y:100}]),[a]);assert.equal(result.dx,0);assert.equal(result.dy,0);
});
