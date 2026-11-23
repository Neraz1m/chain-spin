'use strict';
const $ = id => document.getElementById(id);
const icon = name => '<svg aria-hidden="true"><use href="#i-'+name+'"/></svg>';
const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={btc:'Bitcoin',eth:'Ethereum',sol:'Solana'};
const intervals={btc:'~10 min',eth:'~12 s',sol:'~0.4 s'};
const coins={
  btc:'<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#f79a25"/><path fill="#fff" d="m19.4 7.1.6-2.5-1.65-.4-.58 2.38-1.4-.34.59-2.39-1.66-.4-.59 2.4-4.12-1-.43 1.76 1.69.42c.86.21.95.78.82 1.27l-2.39 9.59c-.1.39-.44.77-1.08.61l-1.67-.4-.79 1.9 4.07 1.02-.6 2.44 1.66.4.59-2.4 1.39.33-.6 2.4 1.66.41.61-2.45c3.91.72 6.86.42 7.99-3.11.9-2.8-.02-4.41-2.08-5.42 1.5-.36 2.59-1.35 2.89-3.39.41-2.77-1.7-4.21-4.9-5.13zm.58 11.42c-.7 2.8-5.38 1.29-6.9.91l1.22-4.88c1.52.38 6.43 1.13 5.68 3.97zm.69-7.1c-.64 2.54-4.53 1.26-5.79.95l1.1-4.43c1.26.32 5.35.89 4.69 3.48z" transform="translate(.3 1.2) scale(.95)"/></svg>',
  eth:'<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#727dda"/><path d="m16 3-8 13.2 8-3.6z" fill="#f2f3ff"/><path d="m16 3 8 13.2-8-3.6z" fill="#bdc7fa"/><path d="m8 16.2 8 4.7v-8.3z" fill="#cbd3ff"/><path d="m24 16.2-8 4.7v-8.3z" fill="#9ba9ee"/><path d="m8 18 8 11v-6.3z" fill="#fff"/><path d="m24 18-8 11v-6.3z" fill="#c3cdf8"/></svg>',
  sol:'<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#20202b"/><path d="m9.5 8 15.5 0-3.1 4H6.4z" fill="#6ae7bf"/><path d="m6.4 14 15.5 0 3.1 4H9.5z" fill="#86a5e7"/><path d="m9.5 20 15.5 0-3.1 4H6.4z" fill="#b388f7"/></svg>'
};
const coin=c=>'<span class="coin">'+coins[c]+'</span>';
const short=id=>id.slice(0,8)+'…'+id.slice(-6);
const date=ms=>new Date(ms).toLocaleString('en-GB',{hour12:false});
const fmt=n=>n.toLocaleString('en-US');
const modeName={second:'1 second',minute:'1 minute',eth:'Next ETH block',btc:'Next BTC block'};
const records=new Map(), prefix='chainspin.round.v1.';
let mode='second', active=null, preparing=false, current=null, storageWarning=false, toastTimer=0;
function toast(msg){$('toast').textContent=msg;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4800);}
function save(item){
  records.set(item.receipt.id,item);
  try{localStorage.setItem(prefix+item.receipt.id,JSON.stringify(item));}
  catch{storageWarning=true;toast('Local storage is unavailable. Export this receipt to keep it.');}
}
function navigate(){
  const v=location.hash.slice(1), key=['history','rules'].includes(v)?v:'board';
  ['board','history','rules'].forEach(id=>$('view-'+id).hidden=id!==key);
  document.querySelectorAll('[data-view]').forEach(e=>{
    if(e.dataset.view===key)e.setAttribute('aria-current','page');else e.removeAttribute('aria-current');
  });
  if(key==='history')renderHistory();if(key==='board')Board.place();
}
function selected(){return Protocol.ids.filter(c=>$('select-'+c).checked);}
function effectiveMode(){return mode==='next'?$('trigger').value:mode;}
function optionName(plan,index){return plan.options?.[index-1] || 'Option '+index;}
function winnerText(plan,index){return optionName(plan,index)+' · #'+index;}
function setState(label,state=''){
  $('board-status').querySelector('span').textContent=label;$('board-status').className='board-state '+state;
}
function configure(reset=true){
  const count=Board.names().length, cs=selected(), locked=preparing || !!active;
  Board.setLocked(locked);
  for(const field of ['chains-field','modes-field'])$(field).disabled=locked;
  $('trigger-row').hidden=mode!=='next';
  [...$('trigger').options].forEach(o=>o.disabled=!cs.includes(o.value));
  if(mode==='next' && !cs.includes($('trigger').value))$('trigger').value=cs.includes('eth')?'eth':cs.includes('btc')?'btc':'';
  document.querySelectorAll('[data-mode]').forEach(b=>{
    b.setAttribute('aria-pressed',String(b.dataset.mode===mode));
    b.disabled=locked || (b.dataset.mode==='next' && !cs.some(c=>c==='eth'||c==='btc'));
  });
  const chain=Protocol.clockChain(effectiveMode(),cs)?.toUpperCase();
  $('mode-hint').textContent=!cs.length?'Select at least one chain.':mode==='next'?'Wait for the next '+chain+' block after locking the board.':
    'Reveal on the first eligible '+chain+' block after the timer ends.';
  $('start').disabled=locked || Board.isEditing() || !cs.length;
  $('start').querySelector('span').textContent=preparing?'Reading snapshots…':active?'Drawing…':Board.isEditing()?'Finish editing to draw':'Start draw';
  $('chance').textContent='1 in '+count+' per tile';
  if(reset && !locked){
    current=null;$('progress-panel').hidden=true;Board.clearResult();setState(Board.isEditing()?'Editing':'Ready',Board.isEditing()?'edit':'');
  }
}
function button(label,fn,symbol){
  const b=document.createElement('button');b.className='small';b.type='button';b.textContent=label;b.onclick=fn;
  if(symbol)b.insertAdjacentHTML('afterbegin',icon(symbol));
  return b;
}
function download(obj,kind){
  const data=new Blob([JSON.stringify(obj,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(data);
  const a=document.createElement('a');a.href=url;a.download='chainspin-'+kind+'-'+obj.id.slice(0,12)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
function exportButton(receipt){
  const snapshot={...receipt};
  return button(snapshot.result?'Export receipt':'Export commitment',()=>download(snapshot,snapshot.result?'proof':'commit'),'upload');
}
function openHistoryImport(){
  location.hash='history';
  // Reveal History while the click can still open its native file picker.
  navigate();
  const trigger=$('import-button');
  trigger.focus();
  trigger.click();
}
function panel(title,line,id='',buttons=[]){
  $('progress-panel').hidden=false;$('progress-title').textContent=title;$('progress-text').textContent=line+(storageWarning?' Local storage is unavailable. Export this receipt.':'');
  $('progress-hash').textContent=id?'Commitment '+id:'';$('progress-actions').replaceChildren(...buttons);
}
function stopRound(item){
  if(active!==item || item.receipt.result)return;
  active=null;item.state='stopped';save(item);configure(false);Board.clearResult();setState('Stopped');
  panel('Draw stopped','The original commitment is saved in History.',item.receipt.id,[button('View commitment',()=>details(item.receipt))]);renderHistory();
}
function installPlan(plan){
  Board.setLabels(plan.options || Array.from({length:plan.count},(_,i)=>'Option '+(i+1)));
  Protocol.ids.forEach(c=>$('select-'+c).checked=plan.anchors.some(a=>a.block.chain===c));
  mode=['eth','btc'].includes(plan.mode)?'next':plan.mode;
  if(mode==='next')$('trigger').value=plan.mode;
}
function wake(chain,ms){
  return new Promise(resolve=>{
    let timer=setTimeout(done,ms);
    function change(e){if(e.detail===chain)done();}
    function done(){clearTimeout(timer);Networks.events.removeEventListener('change',change);resolve();}
    Networks.events.addEventListener('change',change);
  });
}
async function revealDraw(item,animate){
  const {id,plan,result}=item.receipt;
  active=item;current=item;configure(false);
  panel('Board locked','Blocks verified. Finishing the draw…',id);
  await Board.finish(result.winner,animate);
  item.state='drawn';save(item);
  active=null;configure(false);setState('Draw complete','done');
  const chain=Protocol.target(plan).chain.toUpperCase();
  const transfers=document.createElement('div');transfers.className='inline-actions';
  transfers.append(exportButton(item.receipt),button('Import receipt',openHistoryImport,'download'));
  panel('Winner · '+winnerText(plan,result.winner),'Trigger: '+chain+'. Open the receipt to check block hashes and finality.',id,
    [button('View receipt',()=>details(item.receipt)),transfers]);
  renderHistory();
}
async function run(item){
  const {plan,id}=item.receipt,goal=Protocol.target(plan),cursors={};
  active=item;current=item;installPlan(plan);configure(false);Board.clearResult();Board.spin();setState('Drawing','working');
  panel('Board locked','Waiting for the target blocks.',id,[button('Export commitment',()=>download({plan,id,result:null},'commit'),'upload'),button('Stop waiting',()=>stopRound(item))]);
  const message=t=>{if(active===item)$('progress-text').textContent=t+(storageWarning?' Export your commitment to keep it.':'');};
  while(active===item){
    const left=goal.deadline-Date.now();
    if(left>0){message('Draw window opens in '+Math.ceil(left/1000)+' s. Trigger chain: '+goal.chain.toUpperCase()+'.');await new Promise(r=>setTimeout(r,Math.min(left,750)));continue;}
    let retry=0;
    try{
      const blocks=await Networks.resolve(plan,cursors);
      await Networks.checkInputs(plan,blocks);
      const result={blocks,...await Protocol.draw(id,blocks,plan.count)};
      if(active!==item)return;
      item.receipt.result=result;item.state='revealing';save(item);
      break;
    }catch(e){
      if(active!==item)return;
      if(e instanceof Networks.Fork){
        item.state='fork';save(item);active=null;configure(false);Board.clearResult();setState('Chain reorganized');
        panel('Chain reorganization detected',e.message+' The original commitment is saved.',id,[button('View commitment',()=>details(item.receipt))]);renderHistory();return;
      }
      message(e.message+(e instanceof Networks.Pending?'':' Retrying the same target.'));
      retry=e instanceof Networks.Pending?0:5000;
    }
    await new Promise(r=>setTimeout(r,retry || (goal.chain==='sol'?900:1800)));
    if(active===item)await wake(goal.chain,goal.chain==='btc'?10000:2400);
  }
  if(active===item)await revealDraw(item,true);
}
async function start(){
  if(active || preparing || Board.isEditing() || !selected().length)return;
  const options=Board.names(),count=options.length,cs=selected(),chosen=effectiveMode();
  preparing=true;current=null;configure(false);Board.clearResult();setState('Reading snapshots','working');
  panel('Reading chain snapshots','Fetching block hashes and locking the option list.');
  try{
    const trigger=Protocol.clockChain(chosen,cs);
    const snapshots=new Map(await Promise.all(cs.filter(c=>c!==trigger).map(async c=>[c,await Networks.anchor(c)])));
    // Read the trigger last so waiting for slower chains cannot consume its next block.
    snapshots.set(trigger,await Networks.anchor(trigger));
    const anchors=cs.map(c=>snapshots.get(c));
    const plan={version:2,count,options,mode:chosen,created:Date.now(),anchors};
    Protocol.checkPlan(plan);const id=await Protocol.commitment(plan);
    if(Networks.states[trigger].height>=Protocol.target(plan).start)throw new Error('The target block arrived before the commitment was ready. Read fresh snapshots.');
    const item={receipt:{plan,id,result:null},state:'waiting'};save(item);
    preparing=false;await run(item);
  }catch(e){
    preparing=false;active=null;configure(false);Board.clearResult();setState('Ready');
    panel('Could not lock the draw',e.message+' Check your connection and try again.','',[button('Retry snapshots',start)]);
  }
}
function renderNetwork(c){
  const s=Networks.states[c],card=$('network-'+c),b=s.block;
  const status=card.querySelector('.feed-status');
  const label=s.status==='live'?'Live':s.status==='retry'?'Reconnecting':'Connecting';
  if(status.dataset.value!==label){status.dataset.value=label;status.className='feed-status '+(s.status==='live'?'live':b?'poll':'');status.innerHTML='<i></i>'+label;}
  card.querySelector('.block-height').textContent=s.height!==null?fmt(s.height):'—';
  if(b && card.dataset.hash!==b.hash){
    card.dataset.hash=b.hash;
    const link=card.querySelector('.net-bottom a');link.href=Networks.explorer(b);link.title=b.hash;link.innerHTML=esc(short(b.hash))+icon('external');
    card.querySelector('.net-time').textContent=new Date(b.time*1000).toLocaleTimeString('en-GB',{hour12:false});
  }
}
function renderHistory(){
  const list=$('history-list');list.replaceChildren();
  if(!records.size){list.innerHTML='<div class="panel history-empty">'+icon('history')+'<h2>No draws yet</h2><p>Your commitments and block receipts will appear here after your first draw.</p><a class="small" href="#board">Open board</a></div>';return;}
  const labels={revealing:'Finishing draw',waiting:'Waiting for blocks',stopped:'Stopped',fork:'Invalidated by fork',drawn:'Complete'};
  for(const item of [...records.values()].sort((a,b)=>b.receipt.plan.created-a.receipt.plan.created)){
    const {id,plan,result}=item.receipt,row=document.createElement('article');row.className='panel history-row';
    row.innerHTML='<div><div class="row-title"><h2>'+esc(result && item.state!=='revealing'?'Winner · '+winnerText(plan,result.winner):labels[item.state])+'</h2><span class="state">'+esc(modeName[plan.mode])+'</span></div><p class="record-meta">'+esc(date(plan.created))+' · '+plan.count+' options · '+plan.anchors.map(a=>a.block.chain.toUpperCase()).join(' + ')+'</p><p class="record-meta"><code>'+esc(short(id))+'</code></p></div>';
    const actions=document.createElement('div');actions.className='inline-actions';
    if(item.state!=='revealing')actions.append(button('View receipt',()=>details(item.receipt)));
    if(item.state==='waiting' && active!==item && !active && !preparing)actions.append(button('Resume draw',()=>{location.hash='board';run(item);}));
    row.append(actions);list.append(row);
  }
}
async function details(receipt){
  const body=$('dialog-body');$('dialog-title').textContent=receipt.result?'Draw receipt':'Draw commitment';
  const {plan,id,result}=receipt,goal=Protocol.target(plan);
  body.replaceChildren();const summary=document.createElement('div');
  summary.innerHTML='<div class="proof-line"><strong>'+esc(result?'Winner · '+winnerText(plan,result.winner)+' of '+plan.count:'Locked '+plan.count+' options')+'</strong>'+esc(modeName[plan.mode])+' · '+esc(date(plan.created))+'</div><div class="proof-line"><strong>Commitment digest</strong><code>'+esc(id)+'</code></div>'+
    '<div class="proof-line"><strong>Target block</strong>'+goal.chain.toUpperCase()+' from '+fmt(goal.start)+' (first eligible block)'+(goal.deadline?' at or after '+esc(date(goal.deadline)):'')+'.</div>';
  const roles=document.createElement('p');roles.className='dialog-note';
  const future=Protocol.targets(plan).map(g=>g.chain),fixed=plan.anchors.map(a=>a.block.chain).filter(c=>!future.includes(c));
  roles.textContent='Future blocks: '+future.join(', ').toUpperCase()+(fixed.length?'. Snapshots: '+fixed.join(', ').toUpperCase():'')+'.';
  summary.append(roles);
  if(plan.options){
    const options=document.createElement('details'), heading=document.createElement('summary'),list=document.createElement('ol');
    heading.textContent='Committed options ('+plan.count+')';list.className='receipt-options';
    for(const [index,name] of plan.options.entries()){
      const li=document.createElement('li');li.textContent=name;
      if(result?.winner===index+1)li.classList.add('verified');
      list.append(li);
    }
    options.append(heading,list);summary.append(options);
  }
  for(const b of result?.blocks || plan.anchors.map(a=>a.block)){
    const line=document.createElement('div');line.className='proof-line';line.innerHTML='<strong>'+b.chain.toUpperCase()+' · '+(b.chain==='sol'?'Slot ':'Height ')+fmt(b.height)+'</strong><code>'+esc(b.hash)+'</code> <a class="explorer" href="'+esc(Networks.explorer(b))+'" target="_blank" rel="noopener noreferrer">Explorer '+icon('external')+'</a>';summary.append(line);
  }
  if(result){const line=document.createElement('div');line.className='proof-line';line.innerHTML='<strong>Random digest · sampling attempt '+(result.counter+1)+'</strong><code>'+esc(result.hash)+'</code>';summary.append(line);}
  body.append(summary);
  const note=document.createElement('p');note.className='dialog-note';note.setAttribute('role','status');note.textContent='Checking the digest…';
  const actions=document.createElement('div');actions.className='inline-actions';
  const check=button('Verify on mainnet',async()=>{
    check.disabled=true;note.textContent='Checking starting blocks, targets and finality…';
    try{note.textContent=await Networks.audit(receipt);note.className='dialog-note verified';}
    catch(e){note.textContent='Verification incomplete. '+e.message;note.className='dialog-note warning';}finally{check.disabled=false;}
  });
  actions.append(check,exportButton(receipt));
  if(!result)actions.append(button('Reconstruct draw',async e=>{
    const b=e.currentTarget;b.disabled=true;note.textContent='Fetching blocks from the committed plan…';
    try{
      const blocks=await Networks.replay(plan);
      const recovered={plan,id,result:{blocks,...await Protocol.draw(id,blocks,plan.count)}};
      if($('detail').open && note.isConnected)await details(recovered);
    }catch(err){note.textContent=err.message+' Try this commitment again later.';}
    finally{b.disabled=false;}
  }));
  const raw=document.createElement('details');raw.innerHTML='<summary>View complete inputs</summary><pre></pre>';raw.querySelector('pre').textContent=JSON.stringify(receipt,null,2);
  body.append(note,actions,raw);if(!$('detail').open)$('detail').showModal();
  try{await Protocol.verify(receipt);note.textContent=result?'Local calculation matches. Verify on mainnet to check the blocks and finality.':'Commitment matches. Share a copy before the draw.';}
  catch(e){note.textContent=e.message;check.disabled=true;}
}
const rules=[
 ['Lock the options','Each named tile is one entry. Before sampling, the board commits to every name in order, the number of entries, timing, selected chains and starting blocks. A repeated name still occupies a separate numbered slot. Export the commitment before the target block arrives so participants can keep their own copy.'],
 ['Choose the blocks','A timed draw uses the fastest selected chain as its trigger, in the order SOL, ETH, BTC. The first eligible trigger block must reach the committed deadline on its chain clock. Bitcoin and Ethereum start at the next height. Solana starts at the observed slot plus the delay divided by 400 milliseconds, rounded up, and skips empty slots. The one-second and one-minute settings are minimum waits.'],
 ['Mix the selected chains','In next-block mode the trigger is the next Ethereum or Bitcoin height. Companion chains whose expected interval fits within the time budget supply their first future block. Slower chains supply their committed snapshots. WebSocket updates wake the draw. Exact block lookups recover missed updates after reconnecting or reloading.'],
 ['Compute the winner','Serialize recursively sorted object keys as compact UTF-8 JSON. Hash ["ChainSpin/commit/v2", plan] with SHA-256 for the commitment. Version 1 receipts use the v1 commitment domain. Hash ["ChainSpin/entropy/v1", commitment, blocks] for the seed, then hash ["ChainSpin/draw/v1", seed, counter] from counter zero. Each digest is passed as lowercase hexadecimal.'],
 ['Give every tile equal odds','Interpret the draw digest as an unsigned 256-bit integer x. For N options, accept x below 2²⁵⁶ − (2²⁵⁶ mod N), otherwise increment the counter and hash again. The winning index is 1 + (x mod N). With uniform digests, every tile has probability 1/N.'],
 ['Verify a receipt','History accepts both versions. Recalculate a receipt offline, check the blocks against mainnet, or reconstruct the winner from a commitment after its target block arrives. The audit checks six Bitcoin confirmations and finality on Ethereum and Solana. Ethereum draws also check the existing Beacon Roots contract against the block header. Older audits can require archival RPC access.'],
 ['Understand the limits','A static page cannot certify when a commitment was shared or prevent someone from starting other rounds. Share the original commitment before the draw. Block producers can influence blocks, nodes can lag, and reorganizations can invalidate a receipt.']
];
$('rules').innerHTML=rules.map(([h,...p])=>'<article><h2>'+h+'</h2>'+p.map(t=>'<p>'+esc(t)+'</p>').join('')+'</article>').join('')+'<article><h2>Data sources</h2><p><a href="https://mempool.space/docs/api/websocket" target="_blank" rel="noreferrer">mempool.space</a> · <a href="https://geth.ethereum.org/docs/interacting-with-geth/rpc/pubsub" target="_blank" rel="noreferrer">Ethereum newHeads</a> · <a href="https://eips.ethereum.org/EIPS/eip-4788" target="_blank" rel="noreferrer">EIP-4788</a> · <a href="https://solana.com/docs/rpc/http/getblock" target="_blank" rel="noreferrer">Solana getBlock</a></p></article>';
for(const c of Protocol.ids){
  $('chain-options').insertAdjacentHTML('beforeend','<label class="chain-choice"><input id="select-'+c+'" type="checkbox" checked aria-label="'+names[c]+'">'+coin(c)+c.toUpperCase()+'<span class="check">'+icon('check')+'</span></label>');
  $('network-grid').insertAdjacentHTML('beforeend','<article class="network-card" id="network-'+c+'"><div class="net-title">'+coin(c)+'<strong>'+names[c]+'</strong><span class="feed-status"><i></i>Connecting</span></div><div class="height-row"><span>'+(c==='sol'?'Slot':'Height')+' <b class="block-height">—</b></span><span>'+intervals[c]+'</span></div><div class="net-bottom"><a target="_blank" rel="noopener noreferrer" title="Latest block hash">Awaiting block</a><span class="net-time">—</span></div></article>');
  $('select-'+c).onchange=()=>{if(mode==='next'&&!selected().some(x=>['eth','btc'].includes(x)))mode='second';configure();};
}
$('tile-board').addEventListener('optionschange',()=>configure());
$('tile-board').addEventListener('boardnotice',e=>toast(e.detail));
$('trigger').onchange=()=>configure();
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;configure();});
$('start').onclick=start;$('close-detail').onclick=()=>$('detail').close();
$('detail').addEventListener('click',e=>{if(e.target===$('detail') && (e.clientX<$('detail').getBoundingClientRect().left || e.clientX>$('detail').getBoundingClientRect().right || e.clientY<$('detail').getBoundingClientRect().top || e.clientY>$('detail').getBoundingClientRect().bottom))$('detail').close();});
$('import-button').onclick=()=>$('import-file').click();
$('import-file').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{if(f.size>128000)throw new Error('Receipt file is too large.');const r=JSON.parse(await f.text());await Protocol.verify(r);await details(r);}
  catch(err){toast('Receipt rejected. '+err.message);}finally{e.target.value='';}
};
function clock(){$('utc').textContent=new Date().toISOString().slice(11,19)+' UTC';}
window.addEventListener('hashchange',navigate);
Networks.events.addEventListener('change',e=>renderNetwork(e.detail));
async function init(){
  clock();setInterval(clock,1000);configure();navigate();
  $('start').disabled=true;
  try{
    for(const key of Object.keys(localStorage).filter(k=>k.startsWith(prefix))){
      try{const item=JSON.parse(localStorage.getItem(key));await Protocol.verify(item.receipt);
        if(key===prefix+item.receipt.id && ['waiting','stopped','fork','revealing','drawn'].includes(item.state) && (['revealing','drawn'].includes(item.state)===!!item.receipt.result)) records.set(item.receipt.id,item);
      }catch{/* An invalid local record cannot become a winner. */}
    }
  }catch{storageWarning=true;}
  Protocol.ids.forEach(c=>Networks.subscribe(c));const latest=[...records.values()].sort((a,b)=>b.receipt.plan.created-a.receipt.plan.created)[0];
  // A reload during the last steps restores the already verified winner.
  for(const item of records.values()){
    if(item!==latest && item.state==='revealing'){item.state='drawn';save(item);}
  }
  configure(false);renderHistory();
  if(latest?.state==='waiting')run(latest);
  if(latest?.state==='revealing'){installPlan(latest.receipt.plan);await revealDraw(latest,false);}
}
init();
