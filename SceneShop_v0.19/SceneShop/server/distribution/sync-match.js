function median(values){const a=[...values].sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function normalizeSamples(samples){return (Array.isArray(samples)?samples:[]).slice(0,96).map((s,i)=>({hash:String(s&&s.hash||'').toLowerCase().replace(/[^0-9a-f]/g,'').slice(0,32),offset:Number(s&&s.offset)||0,index:i})).filter(s=>s.hash.length>=4&&s.offset>=0&&s.offset<120);}
function rankMatches(samples,rows,{maxDrift=1.0}={}){
  samples=normalizeSamples(samples); if(!samples.length)return[];
  const byHash=new Map(); for(const s of samples){if(!byHash.has(s.hash))byHash.set(s.hash,[]);byHash.get(s.hash).push(s);}
  const groups=new Map();
  for(const r of rows||[]){const hash=String(r.fingerprintHash||r.fingerprint_hash||'').toLowerCase();const sampleHits=byHash.get(hash)||[];for(const s of sampleHits){const workId=r.workId||r.work_id,syncId=r.syncId||r.sync_id;const key=`${workId}\u0000${syncId}`;if(!groups.has(key))groups.set(key,{workId,syncId,bindingId:r.bindingId||null,hits:[]});groups.get(key).hits.push({sampleIndex:s.index,base:Number(r.startSeconds??r.start_seconds??0)-s.offset,quality:Number(r.quality??1)||0});}}
  const ranked=[];
  for(const g of groups.values()){
    const unique=new Map(); for(const h of g.hits){const prev=unique.get(h.sampleIndex);if(!prev||h.quality>prev.quality)unique.set(h.sampleIndex,h);} const hits=[...unique.values()]; if(!hits.length)continue;
    const center=median(hits.map(h=>h.base)); const consensus=hits.filter(h=>Math.abs(h.base-center)<=maxDrift); const matched=consensus.length;
    const coverage=matched/samples.length; const temporal=matched/hits.length; const quality=consensus.reduce((s,h)=>s+h.quality,0)/Math.max(1,matched);
    const confidence=Math.max(0,Math.min(1,coverage*.72+temporal*.23+Math.min(1,quality)*.05));
    ranked.push({...g,position:Math.max(0,Number(center.toFixed(3))),matched,total:samples.length,confidence:Number(confidence.toFixed(6))});
  }
  return ranked.sort((a,b)=>b.confidence-a.confidence||b.matched-a.matched);
}
module.exports={normalizeSamples,rankMatches};
