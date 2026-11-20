// Public, read-only mainnet adapters. Notifications wake the resolver. Exact block
// lookups make its answer independent of missed, duplicated or reordered messages.
const Networks = (() => {
  const http = {
    btc:['https://mempool.space/api','https://blockstream.info/api'],
    eth:['https://ethereum-rpc.publicnode.com','https://eth.drpc.org'],
    sol:['https://solana-rpc.publicnode.com','https://api.mainnet-beta.solana.com']
  };
  const sockets = {
    btc:['wss://mempool.space/api/v1/ws'],
    eth:['wss://ethereum-rpc.publicnode.com','wss://eth.drpc.org'],
    sol:['wss://solana-rpc.publicnode.com','wss://api.mainnet-beta.solana.com']
  };
  const states = Object.fromEntries(Protocol.ids.map(c=>[c,{status:'connecting',height:null,block:null,endpoint:null,last:0}]));
  const events = new EventTarget();
  let rpcId=0;
  class Pending extends Error {}
  class Fork extends Error {}
  const emit = chain => events.dispatchEvent(new CustomEvent('change',{detail:chain}));
  async function request(url,body,text=false) {
    const controller = new AbortController(), timer=setTimeout(()=>controller.abort(),6500);
    try {
      const res=await fetch(url,{method:body?'POST':'GET',signal:controller.signal,cache:'no-store',
        ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
      if (!res.ok) throw new Error('HTTP '+res.status);
      return await (text?res.text():res.json());
    } finally {clearTimeout(timer);}
  }
  async function access(chain, read, alternate=false) {
    const urls=alternate?[...http[chain]].reverse():http[chain];
    let last;
    for (const url of urls) {
      try {return await read(url);} catch(e){last=e;}
    }
    throw new Error(chain.toUpperCase()+' node unavailable ('+(last?.message || 'no response')+')');
  }
  async function rpc(chain,method,params,alt=false) {
    return access(chain,async url=>{
      const msg=await request(url,{jsonrpc:'2.0',id:++rpcId,method,params});
      if(msg.error) throw new Error(msg.error.message || String(msg.error.code));
      if(!Object.hasOwn(msg,'result')) throw new Error('The node returned no result.');
      return msg.result;
    },alt);
  }
  function normalize(chain,b,height) {
    if(!b) throw new Pending('Waiting for '+chain.toUpperCase()+' to provide the block.');
    let row;
    if(chain==='btc') row={height:b.height,hash:b.id,parent:b.previousblockhash,parentHeight:b.height-1,time:b.timestamp};
    if(chain==='eth') row={height:Number(b.number),hash:b.hash,parent:b.parentHash,parentHeight:Number(b.number)-1,time:Number(b.timestamp)};
    if(chain==='sol') row={height,hash:b.blockhash,parent:b.previousBlockhash,parentHeight:b.parentSlot,time:b.blockTime};
    return Protocol.checkBlock({chain,...row});
  }
  async function height(chain,level='latest',alt=false) {
    if(chain==='btc') return Number(await access('btc',u=>request(u+'/blocks/tip/height',null,true),alt));
    if(chain==='eth') {
      if(level==='latest') return Number(await rpc('eth','eth_blockNumber',[],alt));
      return Number((await rpc('eth','eth_getBlockByNumber',[level,false],alt)).number);
    }
    return rpc('sol','getSlot',[{commitment:level==='latest'?'confirmed':level}],alt);
  }
  async function block(chain,h,alt=false) {
    let b;
    if(chain==='btc') b=await access(chain,async u=>{
      const id=(await request(u+'/block-height/'+h,null,true)).trim();
      if(!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid Bitcoin block index.');
      return request(u+'/block/'+id);
    },alt);
    if(chain==='eth') b=await rpc(chain,'eth_getBlockByNumber',['0x'+h.toString(16),false],alt);
    if(chain==='sol') b=await rpc(chain,'getBlock',[h,{commitment:'confirmed',transactionDetails:'none',rewards:false,maxSupportedTransactionVersion:0}],alt);
    const parsed=normalize(chain,b,h);
    if(parsed.height!==h) throw new Error('The node returned a different block height.');
    return parsed;
  }
  async function tip(chain) {
    if(chain==='eth') return normalize(chain,await rpc(chain,'eth_getBlockByNumber',['latest',false]));
    return block(chain,await height(chain));
  }
  async function anchor(chain) {
    const b=await tip(chain);
    const observed=chain==='sol'?Math.max(b.height,states.sol.height||0,await height('sol','processed')):b.height;
    if(chain!=='sol' && states[chain].height>b.height) throw new Error(chain.toUpperCase()+' is catching up. Please retry.');
    return {block:b,observed};
  }
  async function checkAnchors(plan,alt=false) {
    await Promise.all(plan.anchors.map(async({block:a})=>{
      const b=await block(a.chain,a.height,alt);
      if(Protocol.canonical(a)!==Protocol.canonical(b)) throw new Fork(a.chain.toUpperCase()+' starting block differs from the current chain.');
    }));
  }
  // The cursor only advances past actually fetched ineligible blocks. RPC errors
  // never count as skipped slots. Verification starts again at the committed start.
  async function resolveOne(plan,goal,cursor,alt) {
    const c=goal.chain;
    if(goal.deadline && Date.now()<goal.deadline) throw new Pending('Waiting for the draw window to open.');
    const tipHeight=await height(c,'latest',alt);
    if(tipHeight<cursor.next) throw new Pending('Waiting for '+c.toUpperCase()+' to reach '+cursor.next.toLocaleString('en-US'));
    // Recheck the last cursor block when resuming after a wait or RPC failure.
    if(cursor.last) {
      const current=await block(c,cursor.last.height,alt);
      if(current.hash!==cursor.last.hash){cursor.next=goal.start;cursor.last=null;}
    }
    const end=Math.min(tipHeight,cursor.next+63);
    const heights=c==='sol'?await rpc(c,'getBlocks',[cursor.next,end,{commitment:'confirmed'}],alt):
      Array.from({length:end-cursor.next+1},(_,i)=>cursor.next+i);
    for(const h of heights) {
      if(!Number.isSafeInteger(h)||h<cursor.next||h>end) throw new Error('Invalid block order from the node.');
      const candidate=await block(c,h,alt);
      const a=plan.anchors.find(entry=>entry.block.chain===c).block;
      if(c==='sol' && candidate.parentHeight>=cursor.next) throw new Error('The node omitted a parent block in the target range.');
      const previous=cursor.last || (candidate.parentHeight===a.height?a:null);
      if(previous && (previous.height!==candidate.parentHeight || previous.hash!==candidate.parent)) {
        cursor.next=goal.start;cursor.last=null;
        await checkAnchors(plan,alt);
        throw new Pending('The chain reorganized. Rechecking the same target.');
      }
      if(!goal.deadline || candidate.time*1000>=goal.deadline) {
        return candidate;
      }
      cursor.last=candidate;cursor.next=h+1;
    }
    // Do not skip an empty response: a lagging node can temporarily return [].
    throw new Pending('Waiting for an eligible '+c.toUpperCase()+' block (starting at '+cursor.next.toLocaleString('en-US')+')');
  }
  async function resolve(plan,cursors,alt=false) {
    const goals=Protocol.targets(plan);
    const rows=await Promise.allSettled(plan.anchors.map(async({block:a})=>{
      const goal=goals.find(g=>g.chain===a.chain);
      if(!goal) return a;
      const cursor=cursors[a.chain] ||= {next:goal.start,last:null,found:null};
      if(!cursor.found) cursor.found=await resolveOne(plan,goal,cursor,alt);
      return cursor.found;
    }));
    const error=rows.find(row=>row.status==='rejected' && !(row.reason instanceof Pending)) || rows.find(row=>row.status==='rejected');
    if(error) throw error.reason;
    return rows.map(row=>row.value);
  }
  async function checkBeaconRoot(b,alt) {
    const tag='0x'+b.height.toString(16);
    const data='0x'+b.time.toString(16).padStart(64,'0');
    const [header,root]=await Promise.all([
      rpc('eth','eth_getBlockByNumber',[tag,false],alt),
      rpc('eth','eth_call',[{to:'0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02',data},tag],alt)
    ]);
    if(!header || header.hash!==b.hash) throw new Fork('The Ethereum block hash differs from the current chain.');
    if(!/^0x[0-9a-f]{64}$/.test(root) || root!==header.parentBeaconBlockRoot) {
      throw new Error('The Beacon Roots contract and the Ethereum header do not match yet.');
    }
  }
  async function checkInputs(plan,blocks,alt=false){
    const eth=blocks.find(b=>b.chain==='eth');
    await Promise.all([checkAnchors(plan,alt),eth?checkBeaconRoot(eth,alt):Promise.resolve()]);
    await Promise.all(Protocol.targets(plan).map(async goal=>{
      const b=blocks.find(row=>row.chain===goal.chain);
      const fresh=await block(b.chain,b.height,alt);
      if(Protocol.canonical(fresh)!==Protocol.canonical(b)) throw new Fork(b.chain.toUpperCase()+' target block differs from the current chain.');
    }));
  }
  async function replay(plan) {
    const cursors={};
    let blocks;
    while(!blocks) {
      const before=JSON.stringify(cursors);
      try{blocks=await resolve(plan,cursors,true);}
      catch(e){if(!(e instanceof Pending) || before===JSON.stringify(cursors)) throw e;}
    }
    await checkInputs(plan,blocks,true);
    return blocks;
  }
  async function audit(record) {
    await Protocol.verify(record);
    if(!record.result) {
      await checkAnchors(record.plan,true);
      return 'Starting blocks and commitment verified.';
    }
    const blocks=await replay(record.plan);
    if(Protocol.canonical(blocks)!==Protocol.canonical(record.result.blocks)) throw new Fork('Draw inputs differ from the canonical blocks selected by the rules.');
    const statuses=await Promise.all(blocks.map(async b=>{
      const h=await height(b.chain,b.chain==='btc'?'latest':'finalized',true);
      const confirmations=Math.max(0,h-b.height+1);
      if(b.chain==='btc')return 'BTC '+confirmations+(confirmations===1?' confirmation':' confirmations')+' (target 6)';
      return b.chain.toUpperCase()+(h>=b.height?' finalized':' awaiting finality');
    }));
    return 'Mainnet blocks and winner verified. '+(blocks.some(b=>b.chain==='eth')?'The Beacon Roots contract matches the Ethereum header. ':'')+statuses.join(' · ')+'.';
  }
  function showBlock(c,b) {
    const s=states[c];s.block=b;
    if(c!=='sol' || s.height===null || b.height>s.height) s.height=b.height;
    emit(c);
  }
  function subscribe(c) {
    const s=states[c];let attempt=0, idx=0, recentlyRead=0,busy=false;
    async function refresh(){
      if(busy) return; busy=true;recentlyRead=Date.now();
      try{const b=await tip(c);if(!s.block || b.height>=s.block.height || s.status!=='live') showBlock(c,b);}
      catch{if(!s.block && s.status!=='live'){s.status='retry';emit(c);}}
      finally{busy=false;}
    }
    function connect() {
      const url=sockets[c][idx++%sockets[c].length];
      let ws;
      try{ws=new WebSocket(url);}catch{s.status='retry';emit(c);setTimeout(connect,10000);return;}
      let last=Date.now();s.endpoint=url;
      const watchdog=setInterval(()=>{
        if(Date.now()-last>(s.status==='live'?60000:18000)){ws.close();return;}
        if(ws.readyState===1 && c==='btc') ws.send(JSON.stringify({action:'ping'}));
        if(ws.readyState===1 && c==='eth') ws.send(JSON.stringify({jsonrpc:'2.0',id:9,method:'eth_blockNumber',params:[]}));
      },10000);
      ws.onopen=()=>ws.send(JSON.stringify(c==='btc'?{action:'want',data:['blocks']}:
        {jsonrpc:'2.0',id:1,method:c==='eth'?'eth_subscribe':'slotSubscribe',params:c==='eth'?['newHeads']:[]}));
      ws.onmessage=({data})=>{
        try {
          const msg=JSON.parse(data);last=Date.now();
          if(msg.error && msg.id===1){ws.close();return;}
          if(c==='btc' && (msg.block || msg.blocks?.length)) {
            const b=msg.block || msg.blocks.reduce((a,b)=>a.height>b.height?a:b);
            s.status='live';showBlock(c,normalize(c,b));
          } else if(c==='eth' && msg.method==='eth_subscription'){
            s.status='live';showBlock(c,normalize(c,msg.params.result));
          } else if(c==='sol' && msg.method==='slotNotification' && Number.isSafeInteger(msg.params?.result?.slot)){
            s.status='live';s.height=msg.params.result.slot;
            if(Date.now()-recentlyRead>18000) refresh();
            emit(c);
          } else if((msg.id===1 && msg.result!=null) || (c==='btc' && msg.pong)) {s.status='live';emit(c);}
          if(s.status==='live'){s.last=last;attempt=0;}
        }catch{/* A malformed notification never supplies randomness. */}
      };
      ws.onerror=()=>ws.close();
      ws.onclose=()=>{clearInterval(watchdog);s.status='retry';emit(c);setTimeout(connect,Math.min(30000,2000*2**Math.min(4,attempt++)));};
    }
    connect();refresh();
    setInterval(()=>{if(s.status!=='live' || !s.block || (c==='btc' && Date.now()-recentlyRead>90000)) refresh();},15000);
  }
  function explorer(b){return b.chain==='btc'?'https://mempool.space/block/'+b.hash:b.chain==='eth'?'https://etherscan.io/block/'+b.height:'https://explorer.solana.com/block/'+b.height;}
  return {states,events,subscribe,anchor,checkInputs,resolve,replay,audit,explorer,Pending,Fork};
})();
