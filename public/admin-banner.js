(() => {
  const $=id=>document.getElementById(id),form=$('banner-form');
  let config=null,imageBase64,dirty=false,loading=false,selection=0;
  const message=text=>$('banner-message').textContent=text;
  async function load(force=false){
    if(loading||(!force&&config))return;
    loading=true;$('banner-save').disabled=true;
    try{
      const r=await fetch('/api/admin/banner',{cache:'no-store'}),body=await r.json();
      if(!r.ok)throw new Error(body.error||'读取失败');
      config=body;imageBase64=undefined;dirty=false;selection++;
      $('banner-enabled').checked=body.enabled;$('banner-link').value=body.linkUrl;
      $('banner-file').value='';$('banner-preview').hidden=!body.imageUrl;
      if(body.imageUrl)$('banner-preview').src=body.imageUrl;
      $('banner-clicks').textContent=`历史点击：${body.clicks.total} 次 · 当前配置点击：${body.clicks.current} 次（次数不是独立人数）`;
      message('配置已加载。关闭按钮不会计入点击；用户关闭后本次浏览会话不再显示该版本。');
    }catch(e){message(e.message);}finally{loading=false;$('banner-save').disabled=!config;}
  }
  form.addEventListener('input',()=>{dirty=true;});
  $('banner-file').addEventListener('change',async()=>{
    const file=$('banner-file').files[0],ticket=++selection;imageBase64=undefined;
    if(!file)return;
    $('banner-save').disabled=true;
    try{
      if(!['image/png','image/jpeg'].includes(file.type)||file.size>1048576)throw new Error('请选择不超过 1MB 的 PNG/JPEG 图片');
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
      const img=new Image();img.src=data;await img.decode();
      if(img.naturalWidth!==1920||img.naturalHeight!==48)throw new Error('图片尺寸必须为 1920×48px，请重新导出后上传');
      if(ticket!==selection)return;
      imageBase64=data.split(',')[1];$('banner-preview').src=data;$('banner-preview').hidden=false;message('图片检查通过，点击“保存配置”后生效。');
    }catch(e){if(ticket===selection){$('banner-file').value='';message(e.message||'图片无法读取');}}
    finally{if(ticket===selection)$('banner-save').disabled=!config;}
  });
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(!config||loading)return;
    loading=true;$('banner-save').disabled=true;$('banner-reload').disabled=true;
    try{
      const r=await fetch('/api/admin/banner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:config.version,enabled:$('banner-enabled').checked,linkUrl:$('banner-link').value.trim(),...(imageBase64===undefined?{}:{imageBase64})})});
      const body=await r.json();if(!r.ok)throw new Error(body.error||'保存失败');
      config=null;dirty=false;loading=false;await load(true);message('保存成功，网站刷新后生效。');
    }catch(e){message(e.message);}finally{loading=false;$('banner-save').disabled=!config;$('banner-reload').disabled=false;}
  });
  $('banner-reload').addEventListener('click',()=>{if(!dirty||confirm('放弃未保存的修改并重新加载？'))load(true);});
  document.addEventListener('admin-authenticated',()=>load());
  if(!$('dashboard').hidden)load();
})();
