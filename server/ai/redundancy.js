const crypto=require('crypto');
const STATES=new Set(['CONFIRMED','CONFLICT','NO_MATCH','INCONCLUSIVE','SOURCE_UNAVAILABLE']);
const PROVIDERS=new Set(['GOOGLE_VISUAL','MANUFACTURER_CATALOG','RETAILER_CATALOG','SCENESHOP_CATALOG','OTHER']);
const sha=(v)=>crypto.createHash('sha256').update(JSON.stringify(v||{})).digest('hex');
function normalizeVerification(input={}){
  const provider=String(input.provider||'OTHER').toUpperCase();
  const state=String(input.state||'INCONCLUSIVE').toUpperCase();
  if(!PROVIDERS.has(provider))return{errors:['provider redundante inválido.']};
  if(!STATES.has(state))return{errors:['state de verificação inválido.']};
  const confidence=input.confidence==null?null:Math.max(0,Math.min(1,Number(input.confidence)));
  const evidence={...(input.evidence||{})};
  return{verification:{provider,state,proposedBrand:String(input.proposedBrand||'').slice(0,160)||null,proposedModel:String(input.proposedModel||'').slice(0,160)||null,confidence,providerReference:String(input.providerReference||'').slice(0,500)||null,evidence,evidenceSha256:sha(evidence)}};
}
function requiresOperatorFlag(state){return String(state).toUpperCase()!=='CONFIRMED';}
function flagReason(v){switch(v.state){case'CONFLICT':return'REDUNDANCY_CONFLICT';case'NO_MATCH':return'REDUNDANCY_NO_MATCH';case'SOURCE_UNAVAILABLE':return'REDUNDANCY_SOURCE_UNAVAILABLE';default:return'REDUNDANCY_INCONCLUSIVE';}}
module.exports={STATES,PROVIDERS,normalizeVerification,requiresOperatorFlag,flagReason,sha};
