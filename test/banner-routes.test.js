const assert=require('node:assert/strict');
const {newDb}=require('pg-mem');
const {createBannerStore}=require('../lib/banner-store');
const {createBannerRoutes}=require('../lib/banner-routes');
const {png}=require('./banner.test');
(async()=>{
 const pool=new(newDb({noAstCoverageCheck:true}).adapters.createPg().Pool)();
 const store=createBannerStore({pool});let events=0;
 const route=createBannerRoutes({store,admin:r=>r.admin,website:r=>r.website,sameOrigin:r=>r.same,
 readJson:async r=>r.body,json:(r,status,body)=>{r.status=status;r.body=body;},record:()=>events++});
 async function request(path,method='GET',body={},flags={}){const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(bytes){this.bytes=bytes;}};const headers={'content-type':'application/json',...(flags.headers||{})};await route({method,body,...flags,headers},res,new URL(path,'https://example.com'));return res;}
 assert.equal((await request('/api/admin/banner')).status,401);
 assert.equal((await request('/api/admin/banner','POST',{}, {admin:true})).status,403);
 assert.equal((await request('/api/banner')).body.enabled,false);
 const admin={admin:true,same:false,headers:{'x-tinypdf-admin-request':'1'}};
 assert.equal((await request('/api/admin/banner','POST',{enabled:false,version:''},{admin:true,same:true})).status,403);
 const saved=await request('/api/admin/banner','POST',{enabled:true,version:'',linkUrl:'https://example.com',imageBase64:png().toString('base64')},admin);
 assert.equal(saved.status,200);const version=saved.body.version;
 assert.equal((await request('/api/banner')).body.version,version);
 assert.equal((await request('/api/banner/image?v='+version)).headers['Content-Type'],'image/png');
 assert.equal((await request('/api/admin/banner','POST',{enabled:true,version,linkUrl:'javascript:evil'},admin)).status,400);
 assert.equal((await store.get()).version,version);
 const click={version,clickId:'12345678-1234-4123-8123-123456789012'};
 assert.equal((await request('/api/banner/click','POST',click)).status,403);
 assert.equal((await request('/api/banner/click','POST',click,{same:true,website:true})).body.counted,true);
 assert.equal((await request('/api/banner/click','POST',click,{same:true,website:true})).body.counted,false);
 assert.equal(events,1);
 assert.equal((await request('/api/admin/banner','POST',{enabled:false,version:'stale'},admin)).status,409);
 await request('/api/admin/banner','POST',{enabled:false,version},admin);
 assert.equal((await request('/api/banner/image?v='+version)).status,404);
 assert.equal((await request('/api/admin/banner', 'GET',{},admin)).body.clicks.total,1);
 await pool.end();console.log('banner route auth, validation, atomic update and click tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
