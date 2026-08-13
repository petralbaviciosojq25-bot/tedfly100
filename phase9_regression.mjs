import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('./strategy_pack.js',import.meta.url),'utf8');
const context={window:{}};
vm.runInNewContext(source,context,{filename:'strategy_pack.js'});
const packs=context.window.STRATEGY_PACKS;

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const payload=pack=>{const value=JSON.parse(JSON.stringify(pack));for(const key of ['integrity','verification','id','kind','quality','updatedAt','items','fetchedFrom'])delete value[key];return stable(value)};
const digest=pack=>crypto.createHash('sha256').update(JSON.stringify(payload(pack))).digest('hex');
const pack={
  format:'poker-trainer-strategy-pack/v1',name:'Regression solver export',version:'1.0.0',
  source:{url:'https://example.org/solver-export.json',solver:'Regression Solver',exportedAt:'2026-08-13T00:00:00Z'},
  solution:{game:'NLHE',players:6,stackBB:100,bettingTree:'single-raised 2.5x'},
  audit:{status:'solver-verified',reviewer:'Regression'},
  integrity:{algorithm:'sha256',payloadSha256:''},
  nodes:[{id:'river-bb-vs-btn',match:{players:6,stackBB:100,street:'river',heroPosition:'BB',villainPosition:'BTN',facingBet:true},strategy:{frequencies:{fold:.22,call:.68,raise125:.10},evBB:{fold:0,call:1.1,raise125:.7}}}]
};
pack.integrity.payloadSha256=digest(pack);

const report=packs.validate(pack);
assert.equal(report.valid,true);
const matched=packs.matchBest([pack],{players:6,stackBB:100,street:'river',heroPosition:'BB',villainPosition:'BTN',facingBet:true,board:[],texture:'干燥面',lineKey:''});
assert.ok(matched);
assert.equal(matched.frequencies.call,.68);
assert.equal(matched.trust.qualified,false,'client must not treat a self-declared audit as verified without server integrity evidence');
pack.verification={integrityValid:true};
assert.equal(packs.matchBest([pack],{players:6,stackBB:100,street:'river',heroPosition:'BB',villainPosition:'BTN',facingBet:true,board:[],texture:'干燥面',lineKey:''}).trust.qualified,true);
assert.equal(packs.matchBest([pack],{players:6,stackBB:100,street:'turn',heroPosition:'BB',villainPosition:'BTN',facingBet:true,board:[],texture:'干燥面',lineKey:''}),null);

const port=8799;
const server=spawn(process.execPath,['poker_trainer_server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:String(port)},stdio:'ignore'});
try{
  let ready=false;
  for(let attempt=0;attempt<20&&!ready;attempt++){
    try{ready=(await fetch('http://127.0.0.1:'+port+'/api/health')).ok}catch{}
    if(!ready)await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(ready,true,'strategy validation server did not start');
  const response=await fetch('http://127.0.0.1:'+port+'/api/validate-strategy-pack',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(pack)});
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.report.integrityValid,true);
  assert.equal(body.report.qualification,'solver-verified');
}finally{server.kill()}

console.log('phase9 regression ok');
