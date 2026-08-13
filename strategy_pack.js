(function(){
  'use strict';
  const FORMAT='poker-trainer-strategy-pack/v1';
  const ACTIONS=new Set(['fold','check','call','bet','raise','jam','bet33','bet50','bet75','bet125','raise33','raise50','raise75','raise125']);
  const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const normalizedFrequency=frequencies=>{
    if(!plain(frequencies))return null;
    const rows=Object.entries(frequencies).filter(([action,value])=>ACTIONS.has(action)&&finite(value)&&value>=0);
    const total=rows.reduce((sum,[,value])=>sum+value,0);
    if(!rows.length||total<=0)return null;
    return Object.fromEntries(rows.map(([action,value])=>[action,value/total]));
  };
  function validate(pack){
    const errors=[];
    if(!plain(pack))return{valid:false,errors:['策略包必须是 JSON 对象'],nodes:[]};
    if(pack.format!==FORMAT)errors.push('format 必须为 '+FORMAT);
    if(!String(pack.name||'').trim())errors.push('缺少 name');
    if(!String(pack.version||'').trim())errors.push('缺少 version');
    if(!plain(pack.source)||!String(pack.source.url||'').startsWith('https://'))errors.push('source.url 必须是 HTTPS 地址');
    if(!String(pack.source?.solver||'').trim())errors.push('缺少 source.solver；不能声明为求解器策略');
    if(!plain(pack.solution))errors.push('缺少 solution（游戏规则、盲注和下注树）');
    if(!Array.isArray(pack.nodes)||!pack.nodes.length)errors.push('nodes 至少需要一个策略节点');
    const nodes=(pack.nodes||[]).map((node,index)=>{
      const nodeErrors=[];
      if(!plain(node))nodeErrors.push('节点不是对象');
      if(!String(node?.id||'').trim())nodeErrors.push('缺少 id');
      if(!plain(node?.match))nodeErrors.push('缺少 match');
      if(!['preflop','flop','turn','river'].includes(node?.match?.street))nodeErrors.push('match.street 无效');
      if(!String(node?.match?.heroPosition||'').trim())nodeErrors.push('缺少 match.heroPosition');
      if(!String(node?.match?.villainPosition||'').trim())nodeErrors.push('缺少 match.villainPosition');
      const frequencies=normalizedFrequency(node?.strategy?.frequencies);
      if(!frequencies)nodeErrors.push('strategy.frequencies 必须包含正数频率');
      return{index,node,frequencies,errors:nodeErrors};
    });
    nodes.forEach(item=>item.errors.forEach(error=>errors.push('nodes['+item.index+']: '+error)));
    return{valid:errors.length===0,errors,nodes};
  }
  const sameBoard=(left,right)=>Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((card,index)=>card===right[index]);
  function matchNode(node,context){
    const match=node?.match||{};
    if(match.street!==context.street||match.heroPosition!==context.heroPosition||match.villainPosition!==context.villainPosition)return null;
    if(match.players!=null&&Number(match.players)!==Number(context.players))return null;
    if(match.facingBet!=null&&Boolean(match.facingBet)!==Boolean(context.facingBet))return null;
    if(match.stackBB!=null&&Math.abs(Number(match.stackBB)-Number(context.stackBB))>Number(match.stackToleranceBB??.5))return null;
    if(match.board&& !sameBoard(match.board,context.board||[]))return null;
    if(match.texture&&match.texture!==context.texture)return null;
    if(match.lineKey&&match.lineKey!==context.lineKey)return null;
    let specificity=3;
    for(const key of ['players','facingBet','stackBB','board','texture','lineKey'])if(match[key]!=null)specificity++;
    return{specificity,coverage:match.board||match.lineKey?'exact':'constrained'};
  }
  function qualification(pack){
    const verification=pack?.verification||{};
    // Never trust claims embedded in the pack itself. Only a validation service
    // that matched the payload hash against the local trusted-audit registry may
    // set auditTrusted. This prevents a pack from self-labelling as solver/GTO.
    const audited=verification.auditTrusted===true;
    const integrity=verification.integrityValid===true;
    const qualified=audited&&integrity&&verification.qualification==='solver-verified';
    return{audited,integrity,qualified,label:qualified?'可审计 solver 节点':integrity?'完整性已验证，未获可信审核':'未验证策略包'};
  }
  function matchBest(packs,context){
    const candidates=[];
    for(const pack of packs||[]){
      const report=validate(pack);if(!report.valid)continue;
      const trust=qualification(pack);
      for(const item of report.nodes){
        const match=matchNode(item.node,context);
        if(match)candidates.push({pack,node:item.node,frequencies:item.frequencies,match,trust});
      }
    }
    candidates.sort((a,b)=>b.match.specificity-a.match.specificity||Number(b.trust.qualified)-Number(a.trust.qualified));
    return candidates[0]||null;
  }
  function contextFromHand(hand,helpers={}){
    const texture=helpers.texture?helpers.texture(hand.board||[]):'';
    const players=hand.tableMode==='heads'?2:6;
    return{players,stackBB:Number(hand.heroStack||100),street:hand.street,heroPosition:hand.pos,villainPosition:hand.villainPos,facingBet:Number(hand.toCall||0)>0,board:[...(hand.board||[])],texture,lineKey:hand.lineKey||''};
  }
  window.STRATEGY_PACKS={FORMAT,ACTIONS,validate,normalizedFrequency,matchNode,matchBest,qualification,contextFromHand};
})();
