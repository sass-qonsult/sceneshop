'use strict';
const MESSAGE_VERSION=1;
const REQUEST_TYPES=Object.freeze([
  'NATIVE_READY','SHARE','OPEN_EXTERNAL','SECURE_GET','SECURE_SET','SECURE_DELETE','DEVICE_CONTEXT','NOTIFICATION_PERMISSION','NOTIFICATION_REGISTER','SYNC_STARTED','SYNC_STOPPED','SCAN_QR'
]);
const MAX_PAYLOAD_BYTES=16*1024;
function validType(type){ return REQUEST_TYPES.includes(String(type||'').trim().toUpperCase()); }
function payloadBytes(payload){ return Buffer.byteLength(JSON.stringify(payload||{}),'utf8'); }
function validateRequest(message={}){
  const type=String(message.type||'').trim().toUpperCase();
  const requestId=String(message.requestId||'').trim();
  if(!validType(type)) return {ok:false,error:'UNSUPPORTED_TYPE'};
  if(requestId && !/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) return {ok:false,error:'INVALID_REQUEST_ID'};
  if(payloadBytes(message.payload)>MAX_PAYLOAD_BYTES) return {ok:false,error:'PAYLOAD_TOO_LARGE'};
  return {ok:true,value:{version:MESSAGE_VERSION,type,requestId,payload:message.payload||{}}};
}
function response({requestId='',ok=true,value=null,error=null}={}){
  return {version:MESSAGE_VERSION,requestId:String(requestId||''),ok:Boolean(ok),value:ok?value:null,error:ok?null:String(error||'NATIVE_ERROR')};
}
module.exports={MESSAGE_VERSION,REQUEST_TYPES,MAX_PAYLOAD_BYTES,validType,payloadBytes,validateRequest,response};
