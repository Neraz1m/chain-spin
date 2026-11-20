// ChainSpin. This file contains the entire offline commitment and sampling protocol.
const Protocol = (() => {
  const ids = ['btc', 'eth', 'sol'];
  const periods = { btc: 600000, eth: 12000, sol: 400 };
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  function requireValue(ok, message) { if (!ok) throw new Error(message); }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    }
    return JSON.stringify(value);
  }
  function keys(value, names) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).sort().join('|') === names.split(' ').sort().join('|');
  }
  async function digest(value) {
    requireValue(globalThis.crypto?.subtle, 'Open the page over HTTPS, localhost or a local file with Web Crypto support.');
    const bytes = new TextEncoder().encode(canonical(value));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('');
  }
  function checkBlock(block) {
    requireValue(keys(block, 'chain height hash parent parentHeight time'), 'Incomplete block fields.');
    const {chain,height,hash,parent,parentHeight,time} = block;
    requireValue(ids.includes(chain) && integer(height) && integer(parentHeight) && parentHeight < height &&
      integer(time) && time > 0 && (chain === 'sol' || parentHeight === height - 1), 'Invalid block position or timestamp.');
    const pattern = chain === 'eth' ? /^0x[0-9a-f]{64}$/ : chain === 'btc' ? /^[0-9a-f]{64}$/ : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    requireValue(typeof hash === 'string' && typeof parent === 'string' && pattern.test(hash) && pattern.test(parent), 'Invalid block hash format.');
    return block;
  }
  const maxNameLength = 40;
  function validName(name) {
    return typeof name === 'string' && name.length > 0 && name.length <= maxNameLength &&
      name === name.trim() && !/[\u0000-\u001f\u007f]/.test(name);
  }
  function validOptions(names) {
    return Array.isArray(names) && names.length >= 2 && names.length <= 100 && names.every(validName);
  }
  function checkPlan(plan) {
    const named = plan?.version === 2;
    requireValue((named || plan?.version === 1) && keys(plan, named ? 'version count mode created anchors options' : 'version count mode created anchors'), 'Invalid protocol version or plan fields.');
    if (named) requireValue(validOptions(plan.options) && plan.options.length === plan.count, 'Invalid committed option list.');
    requireValue(integer(plan.count) && plan.count >= 2 && plan.count <= 100, 'Choose 2 to 100 options.');
    requireValue(['second','minute','eth','btc'].includes(plan.mode) && integer(plan.created) && plan.created > 0 && plan.created < 8e15, 'Invalid timing rule.');
    requireValue(Array.isArray(plan.anchors) && plan.anchors.length >= 1 && plan.anchors.length <= 3, 'Invalid chain selection.');
    let last = -1;
    for (const anchor of plan.anchors) {
      requireValue(keys(anchor,'block observed'), 'Invalid starting snapshot.');
      const b = checkBlock(anchor.block);
      requireValue(ids.indexOf(b.chain) > last && integer(anchor.observed) && anchor.observed >= b.height &&
        (b.chain === 'sol' || anchor.observed === b.height), 'Invalid chain order or observed height.');
      last = ids.indexOf(b.chain);
    }
    if (['eth','btc'].includes(plan.mode)) requireValue(plan.anchors.some(a => a.block.chain === plan.mode), 'The trigger chain must participate in this draw.');
  }
  function clockChain(mode, chains) {
    return ids.includes(mode) ? mode : [...chains].sort((a,b) => periods[a]-periods[b])[0];
  }
  function target(plan) {
    const chain = clockChain(plan.mode, plan.anchors.map(a => a.block.chain));
    const anchor = plan.anchors.find(a => a.block.chain === chain);
    const delay = {second:1000, minute:60000}[plan.mode] || 0;
    // Allow skipped slots and require chain time to reach the wall-clock deadline.
    const steps = chain === 'sol' ? Math.max(1,Math.ceil(delay / periods.sol)) : 1;
    return {chain, start:anchor.observed + steps, deadline:delay ? plan.created + delay : 0};
  }
  function targets(plan) {
    const trigger = target(plan);
    const budget = {second:1000, minute:60000}[plan.mode] || periods[plan.mode];
    return plan.anchors.flatMap(a => {
      const c = a.block.chain;
      if (c === trigger.chain) return [trigger];
      if (periods[c] > budget) return [];
      // Faster companion chains contribute their first future block. The trigger
      // sets the reveal time. No local arrival order decides membership.
      return [{chain:c, start:a.observed + 1, deadline:0}];
    });
  }
  const commitment = plan => digest(['ChainSpin/commit/v'+plan.version, plan]);
  async function draw(id, blocks, count) {
    const seed = await digest(['ChainSpin/entropy/v1',id,blocks]);
    const n = BigInt(count), span = 1n << 256n, limit = span - span % n;
    for (let counter = 0; ; counter++) {
      const hash = await digest(['ChainSpin/draw/v1',seed,counter]);
      const value = BigInt('0x'+hash);
      if (value < limit) return {seed, counter, hash, winner:Number(value % n)+1};
    }
  }
  async function verify(record) {
    requireValue(record && keys(record, 'plan id result'), 'Choose a ChainSpin JSON receipt.');
    checkPlan(record.plan);
    requireValue(await commitment(record.plan) === record.id, 'The commitment does not match the plan.');
    if (record.result === null) return;
    const r = record.result, plan = record.plan, goals = targets(plan);
    requireValue(keys(r,'blocks seed counter hash winner') && Array.isArray(r.blocks) && r.blocks.length === plan.anchors.length, 'Incomplete draw inputs.');
    for (let i=0;i<r.blocks.length;i++) {
      const b = checkBlock(r.blocks[i]), a = plan.anchors[i].block;
      requireValue(b.chain === a.chain, 'Chain selection mismatch.');
      const goal = goals.find(g => g.chain === b.chain);
      if (!goal) requireValue(canonical(b) === canonical(a), 'Snapshot block differs from the commitment.');
      else requireValue(b.height >= goal.start && (!goal.deadline || b.time*1000 >= goal.deadline) &&
        (goal.deadline || b.parentHeight < goal.start), 'The target block fails the time or height rule.');
    }
    const {blocks,...reported} = r;
    requireValue(canonical(await draw(record.id,blocks,plan.count)) === canonical(reported), 'The digest, counter or winning index differs.');
  }
  return {ids,periods,maxNameLength,validName,validOptions,canonical,digest,checkPlan,checkBlock,clockChain,target,targets,commitment,draw,verify};
})();
