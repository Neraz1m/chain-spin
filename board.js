// The board presents the committed option order. Its animation is independent of sampling.
const Board = (() => {
  const root = document.getElementById('tile-board');
  const byId = id => document.getElementById(id);
  const defaults = ['Nova','Luna','Pico','Echo','Iris','Moss','Sage','Rook','Onyx','Aster','Kite','Tide','Fenn','Reed','Vale','Wren'];
  const patterns = [
    ['0001000','0001000','0011100','1110111','0011100','0001000','0001000'],
    ['0001110','0011000','0110000','0110000','0110000','0011000','0001110'],
    ['0000000','0110110','0110110','0001000','0110110','0110110','0000000'],
    ['0000000','0011000','0100101','0000010','1010010','0101100','0000000'],
    ['0001000','0010100','0100010','1001001','0100010','0010100','0001000'],
    ['0000011','0000011','0001100','0001100','0110000','0110000','1000000'],
    ['0000000','0011000','0011000','1100110','1100110','0011000','0011000'],
    ['0000000','1010101','1111111','0111110','0011100','0011100','0111110'],
    ['0011100','0110110','1100011','1000001','1100011','0110110','0011100'],
    ['1001001','0101010','0011100','1110111','0011100','0101010','1001001'],
    ['0000001','0000011','0000111','0001111','0011111','0111111','1111111'],
    ['0000000','1101101','0010010','0000000','1101101','0010010','0000000'],
    ['0001000','0010100','0010100','0100010','0101010','1001001','1001001'],
    ['0000001','0000001','0001001','0001001','1001001','1001001','1001001'],
    ['0001000','0010100','0100010','1000001','0000000','0000000','0000000'],
    ['1000001','1100011','0110110','0011100','0001000','0001000','0000000']
  ];
  const draftKey = 'chainspin.board.v2';
  let labels = defaults.slice(), editing = false, locked = false;
  let tiles = [], route = [], running = false, timer = 0, cursor = -1, lit = [];
  let animationId = 0, lastMove = 0;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  function pixelGlyph(name) {
    let id=defaults.indexOf(name);
    if(id<0)id=Array.from(name).reduce((h,c)=>(h*31+c.codePointAt(0))>>>0,0)%patterns.length;
    let path='';
    patterns[id].forEach((row,y)=>Array.from(row).forEach((on,x)=>{if(on==='1')path+='M'+x+' '+y+'h1v1h-1z';}));
    return '<svg class="pixel glyph-'+id%4+'" viewBox="0 0 7 7" aria-hidden="true"><path d="'+path+'"/></svg>';
  }
  function toolIcon(name) {return '<svg aria-hidden="true"><use href="#i-'+name+'"/></svg>';}
  function actionButton(action, label) {
    const button=document.createElement('button');
    button.type='button';button.className='tile-action '+action;
    button.setAttribute('aria-label',label);button.title=label;
    button.innerHTML=toolIcon(action==='remove'?'delete':'edit');
    return button;
  }
  function notifyChange(rebuild=true){
    try{localStorage.setItem(draftKey,JSON.stringify(labels));}catch{notify('Draft storage is unavailable in this browser.');}
    if(rebuild)render();
    root.dispatchEvent(new Event('optionschange'));
  }
  function notify(text){root.dispatchEvent(new CustomEvent('boardnotice',{detail:text}));}
  function rename(index) {
    if(!editing || locked)return;
    const tile=tiles[index];
    if(tile.querySelector('input'))return;
    const old=labels[index], input=document.createElement('input');
    input.className='inline-name';input.maxLength=Protocol.maxNameLength;input.value=old;
    input.setAttribute('aria-label','Option name for '+old);
    tile.classList.add('renaming');tile.append(input);input.focus();input.select();
    let finished=false;
    function finish(accept,focusTile){
      if(finished)return;finished=true;
      const value=input.value.trim();
      if(accept && !Protocol.validName(value))notify('Enter a name of 1–40 characters.');
      if(accept && value!==old && Protocol.validName(value)){
        labels[index]=value;tile.title=value;
        tile.querySelector('.tile-name').textContent=value;
        tile.querySelector('.pixel').outerHTML=pixelGlyph(value);
        for(const [selector,verb] of [['.rename','Rename'],['.remove','Delete']]){
          const action=tile.querySelector(selector);
          action.title=verb+' '+value;action.setAttribute('aria-label',action.title);
        }
        notifyChange(false);
      }
      tile.classList.remove('renaming');input.remove();
      if(focusTile)tiles[index]?.querySelector('.rename')?.focus();
    }
    input.onkeydown=event=>{
      if(event.isComposing)return;
      if(event.key==='Enter' || event.key==='Escape'){
        event.preventDefault();finish(event.key==='Enter',true);
      }
    };
    input.onblur=()=>finish(true,false);
  }
  function makeTile(name,index) {
    const tile=document.createElement('div');tile.className='tile';tile.dataset.index=index;
    tile.innerHTML=pixelGlyph(name);
    const label=document.createElement('span');label.className='tile-name';label.textContent=name;
    tile.title=name;tile.append(label);
    if(editing){
      const actions=document.createElement('div');actions.className='tile-actions';
      const remove=actionButton('remove','Delete '+name), edit=actionButton('rename','Rename '+name);
      remove.disabled=labels.length<=2;
      remove.onclick=()=>{if(!editing || locked || labels.length<=2)return;labels.splice(index,1);notifyChange();tiles[Math.min(index,tiles.length-1)].querySelector('.rename').focus();};
      edit.onclick=()=>rename(index);label.onclick=()=>rename(index);
      actions.append(remove,edit);tile.append(actions);
    }
    return tile;
  }
  // Fit a rectangular frame to the available width. A partial outside row is
  // centered on a half-cell grid so odd option counts keep the monitor centered.
  function shape(n,maxCols) {
    if(n<=8)return {cols:Math.min(maxCols,Math.max(4,Math.ceil(n/2))),bands:1,middle:2,sides:0};
    let best,score=Infinity;
    for(let cols=Math.min(5,maxCols);cols<=maxCols;cols++){
      for(let sides=1;sides<=Math.max(1,Math.floor((cols-3)/2));sides++){
        for(let middle=2;middle<=5;middle++){
          const bands=Math.max(1,Math.ceil((n-2*sides*middle)/(2*cols)));
          const cap=2*bands*cols+2*sides*middle;
          if(cap<n || n-2*sides*middle<2*bands)continue;
          const ratio=(middle+2*bands)/cols;
          const cost=(cap-n)*0.8+Math.abs(ratio-2/3)*6+Math.abs(sides-bands)*0.85+Math.max(0,middle-3)*0.5;
          if(cost<score){score=cost;best={cols,bands,middle,sides};}
        }
      }
    }
    return best;
  }
  function place() {
    const width=root.getBoundingClientRect().width;
    if(!width || !tiles.length)return;
    const gap=width<490?6:9;
    const maxCols=Math.min(12,Math.max(4,Math.floor((width+gap)/(52+gap))));
    const {cols,bands,middle,sides}=shape(tiles.length,maxCols);
    const rows=bands*2+middle, cell=(width+gap)/cols-gap, remaining=tiles.length-middle*sides*2;
    root.style.gridTemplateColumns='repeat('+cols*2+', minmax(0,1fr))';
    root.style.gridTemplateRows='repeat('+rows+', '+cell+'px)';
    root.style.gap=gap+'px';root.style.setProperty('--cell',cell+'px');
    const monitor=byId('monitor');
    monitor.style.gridColumn=(2*sides+1)+' / span '+(cols-2*sides)*2;
    monitor.style.gridRow=(bands+1)+' / span '+middle;
    const bandSizes=Array(bands*2).fill(Math.floor(remaining/(2*bands)));
    for(let i=0;i<remaining%(2*bands);i++)bandSizes[i%2===0?Math.floor(i/2):2*bands-1-Math.floor(i/2)]++;
    const points=[];
    for(let y=0;y<rows;y++){
      if(y<bands || y>=bands+middle){
        const size=bandSizes[y<bands?y:y-middle];
        for(let x=0;x<size;x++)points.push({x:x+(cols-size)/2,y});
      }else{
        for(let x=0;x<sides;x++)points.push({x,y});
        for(let x=cols-sides;x<cols;x++)points.push({x,y});
      }
    }
    points.forEach(({x,y},i)=>{
      tiles[i].style.gridColumn=(x*2+1)+' / span 2';
      tiles[i].style.gridRow=String(y+1);
    });
    // Clockwise traversal of each concentric layer keeps the border chase spatial.
    const head=route[cursor];
    route=points.map(({x,y},index)=>({index,layer:Math.floor(Math.min(x,y,cols-1-x,rows-1-y)),
      angle:(Math.atan2(y+.5-rows/2,x+.5-cols/2)+Math.PI*1.5)%(Math.PI*2)}))
      .sort((a,b)=>a.layer-b.layer || a.angle-b.angle).map(p=>p.index);
    cursor=route.indexOf(head);
  }
  function showMessage(caption,value){
    byId('monitor-controls').hidden=true;byId('screen-message').hidden=false;
    byId('screen-label').textContent=caption;byId('screen-value').textContent=value;
  }
  function controls(){
    byId('screen-message').hidden=true;byId('monitor-controls').hidden=false;byId('total').textContent=labels.length;
    byId('add-option').disabled=locked || labels.length>=100;
    byId('edit-options').disabled=locked;
    byId('edit-options').setAttribute('aria-pressed',String(editing));
    byId('edit-options').setAttribute('aria-label',editing?'Finish editing':'Edit options');
    byId('edit-options').title=editing?'Finish editing':'Edit options';
    byId('edit-label').textContent=editing?'Done':'Edit';
    byId('edit-icon').setAttribute('href',editing?'#i-check':'#i-edit');
  }
  function clearTrail(){for(const tile of lit)tile.classList.remove('trail-1','trail-2','trail-3');lit=[];}
  function halt(){clearTimeout(timer);animationId++;running=false;clearTrail();cursor=-1;}
  function render(){
    tiles.forEach(tile=>tile.remove());tiles=labels.map(makeTile);root.append(...tiles);
    root.classList.toggle('editing',editing);place();controls();
  }
  function idle(){
    halt();tiles.forEach(t=>t.classList.remove('winner'));controls();
  }
  function canAnimate(){
    return !motion.matches && !document.hidden && route.length>0 && root.offsetWidth>0;
  }
  function cruiseInterval(){
    return Math.max(34,Math.round(360/Math.sqrt(labels.length)));
  }
  function advance(){
    clearTrail();
    cursor=(cursor+1)%route.length;
    for(let age=0;age<Math.min(3,route.length);age++){
      const tile=tiles[route[(cursor-age+route.length)%route.length]];
      tile.classList.add('trail-'+(3-age));
      lit.push(tile);
    }
    lastMove=performance.now();
  }
  function spin(){
    idle();running=true;showMessage('Reading mainnet','Drawing…');
    function step(){
      if(!running)return;
      if(canAnimate()){
        advance();timer=setTimeout(step,cruiseInterval());
      }else{
        clearTrail();timer=setTimeout(step,250);
      }
    }
    step();
  }
  async function finish(index,animate=true){
    // Transfer the existing head to the finishing sequence without resetting it.
    clearTimeout(timer);running=false;
    const generation=animationId, winner=index-1;
    const brakingSteps=Math.min(8,Math.max(4,labels.length));
    const cruise=cruiseInterval();
    let moved=0;
    while(animate && canAnimate()){
      const length=route.length;
      let remaining=(route.indexOf(winner)-cursor+length)%length;
      // A nearby winner gets another pass so the slowing steps are visible.
      const minimum=brakingSteps-moved;
      if(remaining<minimum)remaining+=length*Math.ceil((minimum-remaining)/length);
      if(remaining===0)break;
      const braking=Math.max(0,1-(remaining-1)/(brakingSteps-1));
      const interval=cruise+(480-cruise)*braking**2;
      const wait=Math.max(0,lastMove+interval-performance.now());
      await new Promise(resolve=>setTimeout(resolve,wait));
      if(generation!==animationId)return;
      if(!canAnimate())break;
      advance();
      moved++;
    }
    // Let the winning head paint before its trail fades and the receipt appears.
    if(moved && canAnimate())await new Promise(resolve=>setTimeout(resolve,130));
    if(generation!==animationId)return;
    tiles[winner].classList.add('winner');
    clearTrail();
    showMessage('Winner · #'+index,labels[winner]);
    byId('monitor-controls').hidden=false;byId('monitor').classList.add('has-winner');
  }
  function clearResult(){byId('monitor').classList.remove('has-winner');idle();}
  function setLabels(values){
    if(labels.length===values.length && values.every((s,i)=>s===labels[i]))return;
    labels=values.slice();render();
  }
  function setLocked(value){
    locked=value;
    if(value && editing){editing=false;render();}
    byId('add-option').disabled=value||labels.length>=100;byId('edit-options').disabled=value;
  }
  byId('add-option').onclick=()=>{
    if(locked||labels.length>=100)return;
    clearResult();let n=labels.length+1;while(labels.includes('Option '+n))n++;
    labels.push('Option '+n);notifyChange();
    tiles.at(-1).animate?.([{opacity:.3,transform:'scale(.88)'},{opacity:1,transform:'scale(1)'}],{duration:motion.matches?0:190});
  };
  byId('edit-options').onclick=()=>{
    if(locked)return;clearResult();editing=!editing;render();root.dispatchEvent(new Event('optionschange'));
    byId('edit-options').focus();
  };
  try{const saved=JSON.parse(localStorage.getItem(draftKey));if(Protocol.validOptions(saved))labels=saved;}catch{/* Start with the sample board. */}
  new ResizeObserver(place).observe(root.parentElement);
  render();
  return {names:()=>labels.slice(),isEditing:()=>editing,setLocked,setLabels,clearResult,spin,finish,place};
})();
