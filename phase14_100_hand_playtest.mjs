import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const here=new URL('.',import.meta.url);
const html=fs.readFileSync(new URL('./texas_holdem_trainer.html',here),'utf8');
const engine=fs.readFileSync(new URL('./gto_engine.js',here),'utf8');
const mainMatch=html.match(/<script>\s*\nconst R='23456789TJQKA'[\s\S]*?<\/script>/);
const phase13Match=html.match(/<script>\s*\n\/\* Phase 13: single-layout poker room[\s\S]*?<\/script>/);
assert.ok(mainMatch,'main trainer script was not found');
assert.ok(phase13Match,'Phase 13 trainer script was not found');
const mainScript=mainMatch[0].replace(/^<script>\s*/,'').replace(/<\/script>$/,'');
const phase13Script=phase13Match[0].replace(/^<script>\s*/,'').replace(/<\/script>$/,'');

class FakeElement {
  constructor(id=''){
    this.id=id;this.innerHTML='';this.textContent='';this.className='';this.value='';this.style={};this.dataset={};this.onclick=null;
    this.classList={add(){},remove(){},contains(){return false;}};
  }
  querySelector(selector){return this.children.get(selector)||(this.children.set(selector,new FakeElement(selector)),this.children.get(selector));}
  querySelectorAll(){return [];}
  appendChild(node){return node;}
  insertAdjacentHTML(){ }
  insertAdjacentElement(){ }
  before(){ }
  get children(){this._children??=new Map();return this._children;}
}

const elements=new Map();
const get=id=>elements.get(id)||(elements.set(id,new FakeElement(id)),elements.get(id));
const document={
  getElementById:get,
  querySelector(selector){return get(selector.replace(/^#/,''));},
  querySelectorAll(){return [];},
  createElement(tag){return new FakeElement(tag);},
  head:new FakeElement('head'),body:new FakeElement('body')
};
get('tableMode').value='6max';
get('scenario').value='random';
const store=new Map();
const localStorage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,String(value)),removeItem:key=>store.delete(key)};
const context={console,document,localStorage,location:{protocol:'http:',origin:'http://localhost:8787'},Math,JSON,Date,Set,Map,Object,Array,Number,String,Boolean,RegExp,Error,Promise,fetch:async()=>({ok:false,json:async()=>({})}),alert(){},setTimeout:fn=>{fn();return 0;},clearTimeout(){}};
context.window=context;
vm.createContext(context);
vm.runInContext(engine,context,{filename:'gto_engine.js'});
vm.runInContext(mainScript,context,{filename:'texas_holdem_trainer.html'});
vm.runInContext(phase13Script,context,{filename:'phase13-trainer.html'});
const trainer=source=>vm.runInContext(source,context,{filename:'phase14-runner'});

const scenarios=['random','btn3bet','turnbarrel','rivercatch','monotone','shortstack','squeeze','icm','wetturn','overbet'];
const sizes=[.33,.5,.75,1.25,'all'];
const openSizes=[2,2.2,2.5,3,4];
const actionCounts={fold:0,check:0,call:0,bet:0,raise:0,jam:0};
const scenarioCounts=Object.fromEntries(scenarios.map(key=>[key,0]));
let preflopAggressions=0;

for(let handNo=0;handNo<100;handNo++){
  const scenario=scenarios[handNo%scenarios.length];
  get('scenario').value=scenario;
  trainer('newHand()');
  scenarioCounts[scenario]++;
  let steps=0;
  while(!trainer('G.done')&&steps<5){
    const hand=trainer('G.hand');
    trainer(`G.hand.betSize=${JSON.stringify(sizes[(handNo+steps)%sizes.length])};G.hand.preflopSize=${openSizes[(handNo+steps)%openSizes.length]}`);
    let action;
    if(steps>=3) action=hand.toCall>0?'fold':hand.street==='preflop'?'fold':'check';
    else if(hand.toCall>0) action=['call','raise','fold','jam'][(handNo+steps)%4];
    else if(hand.street==='preflop') action=['raise','fold','jam'][(handNo+steps)%3];
    else action=['check','bet','jam'][(handNo+steps)%3];
    if(steps===0&&hand.street==='preflop'&&['raise','bet','jam'].includes(action))preflopAggressions++;
    trainer(`act(${JSON.stringify(action)})`);
    actionCounts[action]++;
    steps++;
  }
  if(!trainer('G.done')){trainer(`act('fold')`);actionCounts.fold++;}
  assert.equal(trainer('G.done'),true,`hand ${handNo+1} did not finish`);
  assert.ok(trainer('G.hand.decisions.length')>0,`hand ${handNo+1} recorded no decision`);
  assert.equal(trainer('G.session.hands'),handNo+1,`hand counter drifted on hand ${handNo+1}`);
}

const stats=trainer('G.session');
assert.equal(stats.hands,100);
assert.equal(stats.history.length,100,'history must retain the complete 100-hand playtest');
assert.equal(stats.pfr,preflopAggressions,'PFR must equal first-decision preflop aggression count');
assert.ok(stats.decisions>=100,'every completed hand must contribute at least one decision');
assert.ok(Object.values(stats.actions).every(Number.isFinite),'action counters contain a non-finite value');
assert.ok(Object.values(stats.streets).every(street=>Number.isFinite(street.n)&&Number.isFinite(street.score)),'street statistics contain a non-finite value');
assert.ok(Object.values(stats.spots).every(spot=>Number.isFinite(spot.n)&&Number.isFinite(spot.score)&&Number.isFinite(spot.evLoss)),'spot statistics contain a non-finite value');

console.log(JSON.stringify({
  result:'phase14 100-hand playtest ok',
  hands:stats.hands,
  decisions:stats.decisions,
  historyRetained:stats.history.length,
  averageScore:Math.round(stats.total/Math.max(1,stats.decisions)),
  actionCounts,
  scenarioCounts,
  errors:stats.errors,
  pfr:stats.pfr,
  preflopAggressions,
  recordedSpots:Object.keys(stats.spots).length
},null,2));
