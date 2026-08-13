(function(){
  'use strict';

  const R='23456789TJQKA';
  const POSITIONS=['UTG','HJ','CO','BTN','SB','BB'];
  const ACTIONS=['fold','call','raise'];
  const OPEN_LIMIT={UTG:.70,HJ:.66,CO:.60,BTN:.54,SB:.56,BB:.50};
  const DEFEND_LIMIT={UTG:.72,HJ:.68,CO:.64,BTN:.58,SB:.58,BB:.40};

  function rank(card){return R.indexOf(card[0])+2}
  function handCode(cards){
    if(!cards||cards.length<2)return'??';
    const a=rank(cards[0]),b=rank(cards[1]),hi=Math.max(a,b),lo=Math.min(a,b),code=R[hi-2]+R[lo-2];
    return a===b?code:code+(cards[0][1]===cards[1][1]?'s':'o');
  }
  function rankScore(code){
    if(!code||code==='??')return 0;
    const a=R.indexOf(code[0])+2,b=R.indexOf(code[1])+2,hi=Math.max(a,b),lo=Math.min(a,b),suited=code.endsWith('s');
    if(a===b)return .45+(a-2)/24;
    const gap=hi-lo,connected=gap<=2?.06:gap===3?.02:0;
    return (suited?.25:.12)+(hi+lo-4)/40+(suited?.04:0)+connected;
  }
  function normalize(raw){
    const out={fold:0,call:0,raise:0};
    for(const a of ACTIONS)out[a]=Math.max(0,Number(raw?.[a]||0));
    const total=out.fold+out.call+out.raise;
    if(!total)return{fold:1,call:0,raise:0};
    for(const a of ACTIONS)out[a]=out[a]/total;
    return out;
  }
  function normalizeActions(raw,keys){
    const out={};for(const key of keys)out[key]=Math.max(0,Number(raw?.[key]||0));
    const total=keys.reduce((sum,key)=>sum+out[key],0)||1;for(const key of keys)out[key]=out[key]/total;return out;
  }
  function weightedChoice(strategy,rng=Math.random){
    const s=normalize(strategy),x=rng();let acc=0;
    for(const a of ACTIONS){acc+=s[a];if(x<=acc)return a}
    return'ACTION'.replace('ACTION','fold');
  }
  function styleAdjust(base,bot){
    const s={...base};
    if(bot==='pressure'){
      const raise=Math.min(.75,s.raise+.13),call=Math.max(0,s.call-.08);
      return normalize({raise,call,fold:Math.max(0,1-raise-call)});
    }
    if(bot==='sticky'){
      const call=Math.min(.82,s.call+.16),raise=Math.max(0,s.raise-.08);
      return normalize({raise,call,fold:Math.max(0,1-raise-call)});
    }
    if(bot==='trapper'){
      const raise=Math.min(.62,s.raise+.05),call=Math.min(.72,s.call+.08);
      return normalize({raise,call,fold:Math.max(0,1-raise-call)});
    }
    return normalize(s);
  }
  function baseStrategy({hand,pos,facing=false,bot='solver'}){
    const code=typeof hand==='string'?hand:handCode(hand),score=rankScore(code),p=POSITIONS.includes(pos)?pos:'BTN';
    let result;
    if(!facing){
      const threshold=OPEN_LIMIT[p]||.58;
      if(score>=threshold+.10)result={fold:.01,call:.01,raise:.98};
      else if(score>=threshold)result={fold:.12,call:.03,raise:.85};
      else if(score>=threshold-.06)result={fold:.72,call:.03,raise:.25};
      else result={fold:.98,call:.01,raise:.01};
    }else{
      const defend=DEFEND_LIMIT[p]||.45;
      const blocker=/^A.*s$/.test(code)||/^K.*s$/.test(code);
      if(score>=.84)result={fold:.03,call:.42,raise:.55};
      else if(score>=defend)result={fold:.17,call:.68,raise:.15};
      else if(blocker&&score>=.25)result={fold:.78,call:.02,raise:.20};
      else if(score>=defend-.08)result={fold:.68,call:.28,raise:.04};
      else result={fold:.985,call:.01,raise:.005};
    }
    return styleAdjust(result,bot);
  }
  function strategyFor(opts){
    const s=baseStrategy(opts||{});
    return {...s,hand:typeof opts?.hand==='string'?opts.hand:handCode(opts?.hand),position:opts?.pos||'BTN',facing:!!opts?.facing,model:'6max-100bb-sr-v1'};
  }
  function makeRange(pos,facing=false){
    const range=[];
    for(let hi=12;hi>=0;hi--)for(let lo=12;lo>=0;lo--){
      if(hi<lo)continue;
      const pair=hi===lo;
      for(const suffix of pair?['']:['s','o']){
        const code=pair?R[hi]+R[lo]:R[hi]+R[lo]+suffix;
        const strategy=strategyFor({hand:code,pos,facing});
        range.push({hand:code,weight:1,strategy});
      }
    }
    return range;
  }
  function updateRange(range,action){
    const next=(range||[]).map(item=>({...item,weight:item.weight*Math.max(.001,item.strategy?.[action]??0)}));
    const total=next.reduce((sum,item)=>sum+item.weight,0)||1;
    next.forEach(item=>item.weight/=total);
    return next;
  }
  function topRange(range,n=5){return[...(range||[])].sort((a,b)=>b.weight-a.weight).slice(0,n)}
  function estimateEV({equity=0,pot=0,cost=0}){return Number((equity*(pot+cost)-cost).toFixed(3))}
  function clamp(n,min,max){return Math.max(min,Math.min(max,n))}
  function postflopEV({equity=0,pot=0,toCall=0,betFraction=.5,stack=100}){
    const e=clamp(Number(equity)||0,0,1),p=Math.max(0,Number(pot)||0),callCost=Math.max(0,Number(toCall)||0),betCost=clamp(p*Math.max(.25,Number(betFraction)||.5),1,Math.max(1,Number(stack)||100));
    const foldEquity=clamp(.18+(1-e)*.18+(betFraction>.9?.06:0),.12,.48);
    const callEV=callCost?e*(p+callCost)-callCost:0;
    const betEV=foldEquity*p+(1-foldEquity)*(e*(p+2*betCost)-betCost);
    const raiseCost=callCost?clamp(callCost+betCost,callCost+1,Math.max(callCost+1,Number(stack)||100)):betCost;
    const raiseEV=foldEquity*p+(1-foldEquity)*(e*(p+raiseCost+betCost)-raiseCost);
    return{fold:0,call:Number(callEV.toFixed(3)),raise:Number((callCost?raiseEV:betEV).toFixed(3))};
  }
  function postflopStrategy({equity=0.5,pot=0,toCall=0,street='flop',pos='BTN',madeStrength=0,draw=false,betFraction=.5,stack=100,bot='solver'}={}){
    const e=clamp(Number(equity)||0,0,1),p=Math.max(0,Number(pot)||0),call=Math.max(0,Number(toCall)||0),odds=call?(call/(p+call)):.0,facing=call>0;
    let base;
    let actionKeys;
    if(facing){
      actionKeys=['fold','call','raise'];
      if(e<odds-.10)base={fold:.88,call:.04,raise:draw?.08:.02};
      else if(e<odds+.04)base={fold:.28,call:.60,raise:draw?.12:.04};
      else if(e>=.70||madeStrength>=2)base={fold:.02,call:.28,raise:.70};
      else if(draw)base={fold:.08,call:.62,raise:.30};
      else base={fold:.10,call:.76,raise:.14};
    }else{
      actionKeys=['check','bet'];
      if(e>=.70||madeStrength>=2)base={check:.08,bet:.92};
      else if(e>=.50||draw)base={check:.32,bet:.68};
      else if(e>=.35)base={check:.62,bet:.38};
      else base={check:.82,bet:.18};
      if(pos==='BTN'||pos==='CO')base={...base,bet:base.bet+.06,check:base.check-.06};
      if(street==='river'&&draw&&madeStrength<2)base={...base,bet:base.bet+.08,check:base.check-.08};
    }
    const strategy=actionKeys.includes('fold')?styleAdjust(base,bot):normalizeActions(base,actionKeys),evByAction=postflopEV({equity:e,pot:p,toCall:call,betFraction,stack});
    if(!facing){evByAction.check=0;evByAction.bet=evByAction.raise;delete evByAction.raise;delete evByAction.call;delete evByAction.fold}
    const bestEV=Math.max(...Object.values(evByAction));
    return{...strategy,actionKeys,street,position:pos,facing,odds,equity:e,evByAction,bestEV,model:'6max-100bb-sr-postflop-v2'};
  }

  window.GTO_ENGINE={
    version:'6max-100bb-sr-v1',
    positions:POSITIONS,
    actions:ACTIONS,
    openLimit:OPEN_LIMIT,
    defendLimit:DEFEND_LIMIT,
    handCode,
    rankScore,
    strategyFor,
    weightedChoice,
    makeRange,
    updateRange,
    topRange,
    estimateEV,
    postflopEV,
    postflopStrategy
  };
})();
