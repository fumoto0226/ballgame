// Resolve same-layer overlaps transitively, without changing positions or existing cover edges.
(() => {
  function layers(ids, graph, locked = new Map(), floors = new Map()) {
    const memo = new Map();
    function visit(id, path = new Set()) {
      if (locked.has(id)) return locked.get(id);
      if (memo.has(id)) return memo.get(id);
      if (path.has(id)) return 1;
      const next = new Set(path); next.add(id);
      const covers = (graph.get(id) || []).filter(other => graph.has(other));
      const result = Math.max(floors.get(id) || 1, covers.length ? 1 + Math.max(...covers.map(other => visit(other, next))) : 1);
      memo.set(id, result);
      return result;
    }
    return new Map(ids.map(id => [id, visit(id)]));
  }

  function resolve(blocks, { graph: input, previousLayers, priorityId = null, priorityIds = new Set(), locked = new Map() } = {}) {
    const ids = blocks.map(b => b.id), valid = new Set(ids);
    const graph = new Map(blocks.map(b => [b.id,
      [...new Set(input?.get(b.id) || b.coveredBy || [])].filter(id => id !== b.id && valid.has(id))]));
    const floors = new Map(blocks.map(b=>[b.id,b.layerFloor||1]));
    const original = previousLayers || layers(ids, graph, locked, floors);
    const overlaps = [];
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
      if (window.BlockGeometry.overlaps(blocks[i], blocks[j])) overlaps.push([blocks[i].id, blocks[j].id]);
    }
    let current = layers(ids, graph, locked, floors);
    // A same-depth pair cannot already have a path between its members in an acyclic graph.
    // Each added edge orders one previously unordered pair; at most n(n-1)/2 are needed.
    for (let pass = 0; pass < ids.length * ids.length; pass++) {
      const conflict = overlaps.find(([a, b]) => current.get(a) === current.get(b));
      if (!conflict) break;
      const [a, b] = conflict, layer = current.get(a);
      const aPushed = layer > (original.get(a) ?? layer);
      const bPushed = layer > (original.get(b) ?? layer);
      // Keep the mover and resident blocks in place; the newly displaced block goes deeper.
      const above = priorityIds.has(a) !== priorityIds.has(b) ? (priorityIds.has(a) ? a : b)
        : a === priorityId ? a : b === priorityId ? b
        : aPushed !== bPushed ? (aPushed ? b : a) : b;
      const below = above === a ? b : a;
      if (graph.get(below).includes(above)) break;
      graph.get(below).push(above);
      current = layers(ids, graph, locked, floors);
    }
    return { graph, layers: current };
  }
  // Orient all placement edges from the pre-insertion layer snapshot. Never resolve a half-wired graph.
  function place(blocks, addedIds, targetLayers, previousLayers) {
    const added=new Set(addedIds), graph=new Map(blocks.map(b=>[b.id,[...(b.coveredBy||[])]]));
    for(const block of blocks.filter(b=>added.has(b.id)))for(const other of blocks){
      if(added.has(other.id)||!BlockGeometry.overlaps(block,other))continue;
      const upper=(previousLayers.get(other.id)||1)<(targetLayers.get(block.id)||1)?other:block;
      const lower=upper===other?block:other;
      if(!graph.get(lower.id).includes(upper.id))graph.get(lower.id).push(upper.id);
    }
    return resolve(blocks,{graph,previousLayers,priorityIds:added});
  }
  // Adjacent-layer links alone are insufficient after an intermediate brick dies.
  // Record every geometric cover once, ordered by the authored depth; rotation
  // preserves intersections, and removing bricks can never make a live pair merge.
  function completeCovers(blocks) {
    const graph=new Map(blocks.map(b=>[b.id,[...(b.coveredBy||[])]]));
    const initial=layers(blocks.map(b=>b.id),graph,new Map(),new Map(blocks.map(b=>[b.id,b.layerFloor||1])));
    const order=new Map(blocks.map((b,i)=>[b.id,i]));
    const sorted=[...blocks].sort((a,b)=>initial.get(a.id)-initial.get(b.id)||order.get(a.id)-order.get(b.id));
    for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length;j++) {
      const upper=sorted[i],lower=sorted[j];
      if(BlockGeometry.overlaps(upper,lower)&&!graph.get(lower.id).includes(upper.id))graph.get(lower.id).push(upper.id);
    }
    return graph;
  }
  window.LayerLayout = { layers, resolve, place, completeCovers };
})();
