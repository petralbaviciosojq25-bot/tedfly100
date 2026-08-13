import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import vm from 'node:vm';

const clientSource=fs.readFileSync(new URL('./strategy_pack.js',import.meta.url),'utf8');
const context={window:{}};
vm.runInNewContext(clientSource,context,{filename:'strategy_pack.js'});
const client=context.window.STRATEGY_PACKS;
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const payload=pack=>{const value=JSON.parse(JSON.stringify(pack));for(const key of ['integrity','verification','id','kind','quality','updatedAt','items','fetchedFrom'])delete value[key];return stable(value)};
const digest=pack=>crypto.createHash('sha256').update(JSON.stringify(payload(pack))).digest('hex');
const pack={
  format:'poker-trainer-strategy-pack/v1',name:'Phase 10 registry fixture',version:'1.0.0',
  source:{url:'https://example.org/phase10.json',solver:'Regression Solver',exportedAt:'2026-08-13T00:00:00Z'},
  solution:{game:'NLHE',players:6,stackBB:100,bettingTree:'river facing 75%'},
  audit:{status:'solver-verified',reviewer:'Self declaration must be ignored'},
  integrity:{algorithm:'sha256',payloadSha256:''},
  nodes:[{id:'river-bb-vs-btn',match:{players:6,stackBB:100,street:'river',heroPosition:'BB',villainPosition:'BTN',facingBet:true},strategy:{frequencies:{fold:.22,call:.68,raise125:.10},evBB:{fold:0,call:1.1,raise125:.7}}}]
};
pack.integrity.payloadSha256=digest(pack);

assert.equal(client.validate(pack).valid,true);
assert.equal(client.qualification(pack).qualified,false,'pack claims are not trusted by the client');
pack.verification={integrityValid:true,qualification:'solver-verified'};
assert.equal(client.qualification(pack).qualified,false,'missing registry attestation must fail');
pack.verification={integrityValid:true,auditTrusted:true,qualification:'solver-verified'};
assert.equal(client.qualification(pack).qualified,true);

async function withServer(port,extraEnv,run){
  const server=spawn(process.execPath,['poker_trainer_server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:String(port),...extraEnv},stdio:'ignore'});
  try{
    let ready=false;
    for(let attempt=0;attempt<30&&!ready;attempt++){
      try{ready=(await fetch('http://127.0.0.1:'+port+'/api/health')).ok}catch{}
      if(!ready)await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(ready,true,'validation server did not start');
    await run('http://127.0.0.1:'+port);
  }finally{server.kill()}
}
async function validateAt(base,value){
  const response=await fetch(base+'/api/validate-strategy-pack',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
  return{response,body:await response.json()};
}

delete pack.verification;
await withServer(8810,{},async base=>{
  const {response,body}=await validateAt(base,pack);
  assert.equal(response.status,200);
  assert.equal(body.report.integrityValid,true);
  assert.equal(body.report.auditDeclared,true);
  assert.equal(body.report.auditTrusted,false);
  assert.equal(body.report.qualification,'integrity-verified');
});

const registry={
  format:'poker-trainer-trusted-audits/v1',version:'regression-1',
  entries:[{payloadSha256:pack.integrity.payloadSha256,sourceUrl:pack.source.url,solver:pack.source.solver,packName:pack.name,packVersion:pack.version,reviewer:'Regression Registry'}]
};
await withServer(8811,{TRUSTED_AUDITS_JSON:JSON.stringify(registry)},async base=>{
  const verified=await validateAt(base,pack);
  assert.equal(verified.body.report.auditTrusted,true);
  assert.equal(verified.body.report.qualification,'solver-verified');
  assert.equal(verified.body.report.registryVersion,'regression-1');
  const tampered=JSON.parse(JSON.stringify(pack));tampered.nodes[0].strategy.frequencies.call=.99;
  const rejected=await validateAt(base,tampered);
  assert.equal(rejected.body.report.integrityValid,false);
  assert.equal(rejected.body.report.auditTrusted,false);
  assert.equal(rejected.body.report.qualification,'unverified');
});

const html=fs.readFileSync(new URL('./texas_holdem_trainer.html',import.meta.url),'utf8');
assert.match(html,/可审计 Solver 节点覆盖率/);
assert.match(html,/选择策略包 JSON/);
assert.match(html,/这些建议不能标记为 GTO/);
console.log('phase10 regression ok');
