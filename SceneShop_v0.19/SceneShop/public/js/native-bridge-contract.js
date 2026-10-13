(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.SceneShopNativeContract=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const MESSAGE_VERSION=1;
  const REQUEST_TYPES=Object.freeze(['NATIVE_READY','SHARE','OPEN_EXTERNAL','SECURE_GET','SECURE_SET','SECURE_DELETE','DEVICE_CONTEXT','NOTIFICATION_PERMISSION','NOTIFICATION_REGISTER']);
  const MAX_PAYLOAD_BYTES=16*1024;
  function validType(type){return REQUEST_TYPES.includes(String(type||'').trim().toUpperCase());}
  function payloadBytes(payload){return new TextEncoder().encode(JSON.stringify(payload||{})).length;}
  function validateRequest(message={}){
    const type=String(message.type||'').trim().toUpperCase();
    const requestId=String(message.requestId||'').trim();
    if(!validType(type)) return{ok:false,error:'UNSUPPORTED_TYPE'};
    if(requestId&&!/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) return{ok:false,error:'INVALID_REQUEST_ID'};
    if(payloadBytes(message.payload)>MAX_PAYLOAD_BYTES) return{ok:false,error:'PAYLOAD_TOO_LARGE'};
    return{ok:true,value:{version:MESSAGE_VERSION,type,requestId,payload:message.payload||{}}};
  }
  return{MESSAGE_VERSION,REQUEST_TYPES,MAX_PAYLOAD_BYTES,validType,payloadBytes,validateRequest};
});
