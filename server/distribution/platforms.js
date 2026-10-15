const PLATFORM_CODES=new Set(['YOUTUBE','INSTAGRAM','TIKTOK','PARTNER_SITE','PARTNER_APP','TV','OTT','OTHER']);
const PLATFORM_KINDS=new Set(['SOCIAL_VIDEO','OWNER_SITE','OWNER_APP','BROADCAST','OTT','OTHER']);
function normalizePlatform(v){const p=String(v||'OTHER').trim().toUpperCase().replace(/[- ]/g,'_');return PLATFORM_CODES.has(p)?p:'OTHER';}
function platformKind(platform){switch(normalizePlatform(platform)){case'YOUTUBE':case'INSTAGRAM':case'TIKTOK':return'SOCIAL_VIDEO';case'PARTNER_SITE':return'OWNER_SITE';case'PARTNER_APP':return'OWNER_APP';case'TV':return'BROADCAST';case'OTT':return'OTT';default:return'OTHER';}}
function httpUrl(v){try{const u=new URL(String(v||''));return /^https?:$/.test(u.protocol)?u:null;}catch{return null;}}
function parseExternalUrl(value){
  const u=httpUrl(value); if(!u)return null; const host=u.hostname.toLowerCase().replace(/^www\./,''); const path=u.pathname.split('/').filter(Boolean);
  if(host==='youtu.be'&&path[0])return{platform:'YOUTUBE',externalContentId:path[0],canonicalUrl:`https://youtu.be/${path[0]}`};
  if(host.endsWith('youtube.com')){
    const id=u.searchParams.get('v') || ((path[0]==='shorts'||path[0]==='embed'||path[0]==='live')&&path[1]) || null;
    if(id)return{platform:'YOUTUBE',externalContentId:id,canonicalUrl:`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`};
  }
  if(host.endsWith('instagram.com')&&['reel','p','tv'].includes(path[0])&&path[1])return{platform:'INSTAGRAM',externalContentId:path[1],canonicalUrl:`https://www.instagram.com/${path[0]}/${path[1]}/`};
  if((host==='tiktok.com'||host.endsWith('.tiktok.com'))){const i=path.indexOf('video');if(i>=0&&path[i+1])return{platform:'TIKTOK',externalContentId:path[i+1],canonicalUrl:`https://www.tiktok.com/${path.slice(0,i+2).join('/')}`};}
  return{platform:'OTHER',externalContentId:null,canonicalUrl:u.toString()};
}
module.exports={PLATFORM_CODES,PLATFORM_KINDS,normalizePlatform,platformKind,parseExternalUrl,httpUrl};
