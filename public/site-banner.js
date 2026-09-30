/* Independent of compression state: closing/navigating must not reset the selected PDF. */
(() => {
  const zh=document.documentElement.lang.startsWith('zh');
  fetch('/api/banner',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(config=>{
    if(!config?.enabled||!config.imageUrl)return;
    try{if(sessionStorage.getItem('tinypdf.banner.closed')===config.version)return;}catch{}
    const destination=new URL(config.linkUrl);
    if(destination.protocol!=='https:')return;
    const bar=document.createElement('aside');bar.className='site-banner';
    const link=document.createElement('a');link.href=destination.href;link.target='_blank';link.rel='noopener noreferrer';
    link.setAttribute('aria-label',zh?'查看活动（新窗口打开）':'View promotion (opens in a new tab)');
    const img=new Image();img.alt='';img.width=1920;img.height=40;
    const close=document.createElement('button');close.type='button';close.className='site-banner-close';close.textContent='×';close.setAttribute('aria-label',zh?'关闭横幅':'Close banner');
    const syncHeight=()=>document.body.style.setProperty('--announcement-height',`${bar.isConnected?bar.offsetHeight:0}px`);
    const observer=new ResizeObserver(syncHeight);
    close.addEventListener('click',()=>{observer.disconnect();bar.remove();syncHeight();try{sessionStorage.setItem('tinypdf.banner.closed',config.version);}catch{}});
    const track=e=>{
      if(e.button!==0&&e.button!==1)return;
      const body=JSON.stringify({version:config.version,clickId:crypto.randomUUID()});
      fetch('/api/banner/click',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true}).catch(()=>{});
    };
    link.addEventListener('click',track);link.addEventListener('auxclick',track);
    link.append(img);bar.append(link,close);
    img.onload=()=>{document.body.prepend(bar);observer.observe(bar);syncHeight();};img.src=config.imageUrl;
  }).catch(()=>{});
})();
