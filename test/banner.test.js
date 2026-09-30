const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const zlib = require('node:zlib');
const { createBannerStore, validateImage, validateLink } = require('../lib/banner-store');

// Tiny, real PNG fixture: opaque pixels, CRC-protected chunks, no personal image.
function png(width = 1920, height = 48) {
  function chunk(type, data) {
    const content = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of content) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const size = Buffer.alloc(4), sum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, content, sum]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4); header[8]=8; header[9]=2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.alloc((width*3+1)*height,0))),chunk('IEND',Buffer.alloc(0))]);
}
async function run() {
  // pg-mem's AST checker rejects IF NOT EXISTS when a second store reopens tables.
  const pool = new (newDb({noAstCoverageCheck:true}).adapters.createPg().Pool)();
  const store = createBannerStore({pool});
  assert.equal((await store.get()).enabled,false);
  assert.throws(()=>validateImage(png(100,48)), /1920/);
  assert.throws(()=>validateImage(Buffer.from('<svg onload="alert(1)"/>')), /PNG|JPEG/);
  assert.throws(()=>validateImage(Buffer.alloc(1048577)), /1MB/);
  assert.throws(()=>validateLink('javascript:alert(1)'), /HTTPS/);
  assert.throws(()=>validateLink('https://user:password@example.com'), /HTTPS/);
  assert.equal(validateLink('https://example.com/path'), 'https://example.com/path');
  await assert.rejects(store.save({enabled:true,linkUrl:'https://example.com',version:''}), /图片/);
  const first = await store.save({enabled:true,linkUrl:'https://example.com',version:'',imageBase64:png().toString('base64')});
  assert.equal(first.enabled,true);
  assert.deepEqual((await store.image(first.version)).bytes,png());
  assert.equal(await store.click(first.version,'12345678-1234-4123-8123-123456789012'),true);
  assert.equal(await store.click(first.version,'12345678-1234-4123-8123-123456789012'),false);
  assert.equal((await store.stats(first.version)).total,1);
  // New store instance reads the same durable DB, not process-local state.
  const restarted = createBannerStore({pool});
  assert.equal((await restarted.get()).version,first.version);
  await assert.rejects(store.save({enabled:false,linkUrl:'https://example.com',version:'stale'}), /重新加载/);
  const disabled = await store.save({enabled:false,linkUrl:first.linkUrl,version:first.version});
  assert.equal(disabled.enabled,false);
  assert.equal(await store.click(disabled.version,'22345678-1234-4123-8123-123456789012'),false);
  assert.equal((await store.stats(disabled.version)).total,1);
  assert.equal((await store.image(disabled.version)).bytes.length,png().length);
  const offline = createBannerStore({});
  await assert.rejects(offline.save({}), /数据库/);
  console.log('banner validation, persistence, revision and click tests passed');
  await pool.end();
}
if(require.main===module) run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={png};
