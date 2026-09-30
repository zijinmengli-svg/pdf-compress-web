'use strict';
function createBannerRoutes({store,admin,website,sameOrigin,readJson,json,record}) {
  const limits=new Map();
  return async function(req,res,url) {
    const path=url.pathname;
    if(!['/api/banner','/api/banner/image','/api/banner/click','/api/admin/banner'].includes(path))return false;
    const reply=(status,body)=>json(res,status,body,{'Cache-Control':'no-store'});
    if(path==='/api/admin/banner'&&!admin(req)){reply(401,{error:'请先登录后台'});return true;}
    try {
      if(req.method==='GET'&&path==='/api/banner') {
        try {const c=await store.get();reply(200,c.enabled?c:{enabled:false});}
        catch {reply(200,{enabled:false});}
      } else if(req.method==='GET'&&path==='/api/banner/image') {
        const img=await store.image(url.searchParams.get('v'));
        if(!img||(!img.enabled&&!admin(req)))reply(404,{error:'图片不可用'});
        else {res.writeHead(200,{'Content-Type':img.mime,'Content-Length':img.bytes.length,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'});res.end(img.bytes);}
      } else if(req.method==='GET'&&path==='/api/admin/banner') {
        const config=await store.get();reply(200,{...config,clicks:await store.stats(config.version)});
      } else if(req.method==='POST'&&(path==='/api/admin/banner'||path==='/api/banner/click')) {
        if(!sameOrigin(req)||(path==='/api/banner/click'&&!website(req))){reply(403,{error:'请从网站页面操作'});return true;}
        if(!(req.headers['content-type']||'').startsWith('application/json')){reply(415,{error:'请求格式错误'});return true;}
        if(path==='/api/banner/click') {
          const now=Date.now(),key=req.headers.cookie||'';
          for(const [k,v]of limits)if(v.until<now)limits.delete(k);
          const item=limits.get(key)||{count:0,until:now+60000};
          if(item.count>=30||(!limits.has(key)&&limits.size>=10000)){reply(429,{error:'操作过于频繁'});return true;}
          item.count++;limits.set(key,item);
          const body=await readJson(req,4096);
          const counted=await store.click(String(body.version||''),String(body.clickId||''));
          if(counted)record(req,url,'banner_clicked',{bannerVersion:body.version});
          reply(200,{counted});
        } else {
          const body=await readJson(req,1450000);
          // Validate before any write; a rejected upload leaves the previous banner intact.
          try {reply(200,await store.save(body));}
          catch(e){if(/图片|链接|配置格式|开启前/.test(e.message))reply(400,{error:e.message});else if(/配置已被修改/.test(e.message))reply(409,{error:e.message});else throw e;}
        }
      } else reply(405,{error:'不支持的请求方法'});
    } catch(e) {
      console.error('[banner]',e.message);
      reply(503,{error:'Banner 保存或读取失败，请稍后重试；原配置未被替换'});
    }
    return true;
  };
}
module.exports={createBannerRoutes};
