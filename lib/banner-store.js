'use strict';
const crypto = require('node:crypto');
const { Pool } = require('pg');
const MAX_IMAGE_BYTES = 1024 * 1024;

function validateLink(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('请输入有效的 HTTPS 链接');
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入完整的 HTTPS 链接'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('只允许不含账号密码的 HTTPS 链接');
  return url.href;
}

function validateImage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_IMAGE_BYTES) throw new Error('图片不能超过 1MB');
  let width, height, mime;
  if (bytes.length >= 33 && bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) {
    let offset=8, header=false, data=false, end=false;
    while (offset+12 <= bytes.length) {
      const size=bytes.readUInt32BE(offset), type=bytes.toString('ascii',offset+4,offset+8);
      if (offset+12+size>bytes.length) throw new Error('PNG 图片不完整');
      if (!header) {
        if(type!=='IHDR'||size!==13) throw new Error('PNG 图片格式错误');
        width=bytes.readUInt32BE(offset+8); height=bytes.readUInt32BE(offset+12); header=true;
      }
      if (type==='acTL') throw new Error('请上传静态 PNG/JPEG 图片');
      if (type==='IDAT' && size>0) data=true;
      offset+=12+size;
      if (type==='IEND') {end=size===0 && offset===bytes.length; break;}
    }
    if(!data||!end) throw new Error('PNG 图片不完整');
    mime='image/png';
  } else if (bytes.length>=4 && bytes[0]===255 && bytes[1]===216 && bytes.at(-2)===255 && bytes.at(-1)===217) {
    let offset=2;
    while(offset+4<bytes.length) {
      if(bytes[offset++]!==255) throw new Error('JPEG 图片格式错误');
      while(bytes[offset]===255) offset++;
      const marker=bytes[offset++];
      if(marker===0xda) break;
      const size=bytes.readUInt16BE(offset);
      if(size<2||offset+size>bytes.length) throw new Error('JPEG 图片不完整');
      if([0xc0,0xc1,0xc2].includes(marker) && size>=8) {height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);}
      offset+=size;
    }
    mime='image/jpeg';
  } else throw new Error('只支持 PNG/JPEG 图片');
  if(width!==1920||height!==48) throw new Error('图片尺寸必须为 1920×48px');
  return {mime,width,height};
}

function createBannerStore({databaseUrl='',pool=null}={}) {
  const db=pool || (databaseUrl ? new Pool({connectionString:databaseUrl,max:2,connectionTimeoutMillis:3000,query_timeout:5000}) : null);
  if(db&&!pool)db.on('error',()=>console.error('[banner] database connection interrupted'));
  let readyPromise;
  async function ready() {
    if(!db) throw new Error('未配置数据库，无法持久保存 Banner');
    if(!readyPromise) readyPromise=(async()=>{
      await db.query(`CREATE TABLE IF NOT EXISTS site_banner (
        id integer PRIMARY KEY CHECK (id = 1), enabled boolean NOT NULL DEFAULT false,
        version text NOT NULL DEFAULT '', link_url text NOT NULL DEFAULT '',
        image_base64 text NOT NULL DEFAULT '', mime text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now())`);
      await db.query("INSERT INTO site_banner(id) VALUES (1) ON CONFLICT(id) DO NOTHING");
      await db.query(`CREATE TABLE IF NOT EXISTS banner_click_events (
        click_id uuid PRIMARY KEY, banner_version text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now())`);
      await db.query('CREATE INDEX IF NOT EXISTS banner_click_version_idx ON banner_click_events(banner_version)');
    })().catch(e=>{readyPromise=null;throw e;});
    return readyPromise;
  }
  async function row(){await ready();return (await db.query('SELECT * FROM site_banner WHERE id=1')).rows[0];}
  function config(r){return {enabled:r.enabled,version:r.version,linkUrl:r.link_url,imageUrl:r.image_base64?`/api/banner/image?v=${encodeURIComponent(r.version)}`:'',updatedAt:r.updated_at};}
  return {
    ready,
    async get(){return config(await row());},
    async save(input){
      await ready();
      if(!input||typeof input.enabled!=='boolean'||typeof input.version!=='string') throw new Error('Banner 配置格式错误');
      const current=await row();
      if(current.version!==input.version) throw new Error('配置已被修改，请重新加载后再保存');
      const link=input.linkUrl ? validateLink(input.linkUrl) : '';
      let base64=current.image_base64,mime=current.mime;
      if(input.imageBase64!==undefined){
        if(typeof input.imageBase64!=='string'||input.imageBase64.length>Math.ceil(MAX_IMAGE_BYTES/3)*4||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.imageBase64)) throw new Error('图片数据无效或超过 1MB');
        const bytes=Buffer.from(input.imageBase64,'base64');
        mime=validateImage(bytes).mime; base64=bytes.toString('base64');
      }
      if(input.enabled && (!base64 || !link)) throw new Error('开启前请上传图片并填写跳转链接');
      const version=crypto.randomUUID();
      const result=await db.query(`UPDATE site_banner SET enabled=$1,version=$2,link_url=$3,image_base64=$4,mime=$5,updated_at=$6 WHERE id=1 AND version=$7 RETURNING *`,[input.enabled,version,link,base64,mime,new Date(),current.version]);
      if(!result.rows.length) throw new Error('配置已被修改，请重新加载后再保存');
      return config(result.rows[0]);
    },
    async image(version){const r=await row();return r.version===version && r.image_base64 ? {bytes:Buffer.from(r.image_base64,'base64'),mime:r.mime,enabled:r.enabled}:null;},
    async click(version,clickId){
      await ready();
      if(!/^[0-9a-f-]{36}$/i.test(version)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clickId)) return false;
      const result=await db.query(`INSERT INTO banner_click_events(click_id,banner_version)
        SELECT $1,$2 FROM site_banner WHERE id=1 AND version=$2 AND enabled=true
        AND NOT EXISTS (SELECT 1 FROM banner_click_events WHERE click_id=$1)
        ON CONFLICT(click_id) DO NOTHING RETURNING click_id`,[clickId,version]);
      return result.rows.length>0;
    },
    async stats(version){await ready();const total=(await db.query('SELECT COUNT(*) AS count FROM banner_click_events')).rows[0];const current=(await db.query('SELECT COUNT(*) AS count FROM banner_click_events WHERE banner_version=$1',[version])).rows[0];return {total:Number(total.count),current:Number(current.count)};},
    async close(){if(db&&!pool)await db.end();},
  };
}
module.exports={createBannerStore,validateImage,validateLink,MAX_IMAGE_BYTES};
