// Native production regression checks. Uses Node, Windows, and the existing WebView2.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
const args=process.argv.slice(2);
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const exe=path.resolve(option('--exe','target/release/litemd.exe'));
const root=path.resolve(option('--output','.cache/native-rendering-'+Date.now()));
const first=path.join(root,'one'),second=path.join(root,'two'),outside=path.join(root,'outside');
const data=path.join(root,'data'),profile=path.join(root,'webview2');
for(const dir of [first,second,outside,path.join(first,'figures'),path.join(data,'.cache'),profile,path.join(root,'tmp')])await fs.mkdir(dir,{recursive:true});
const svg=width=>'<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="60"><defs><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>';
await fs.writeFile(path.join(first,'plot.svg'),svg(120));await fs.writeFile(path.join(second,'plot.svg'),svg(260));
await fs.writeFile(path.join(first,'figures','plot.svg'),svg(80));
await fs.writeFile(path.join(first,'figures','גרף עם רווח.svg'),svg(95));
await fs.writeFile(path.join(outside,'plot.svg'),svg(999));
await fs.writeFile(path.join(first,'wrong.png'),'not a PNG');
await fs.writeFile(path.join(first,'attack.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><script>fetch("https://attacker.invalid/svg-script")</script><image href="https://attacker.invalid/svg-image" width="1" height="1"/><rect width="40" height="30" fill="green"/></svg>');
const common='![Plot](./plot.svg)';
for(const dir of [first,second])await fs.writeFile(path.join(dir,'document.md'),common);
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const setup = 'Add-Type -AssemblyName System.Drawing; $bitmap=[Drawing.Bitmap]::new(8,6); $bitmap.SetPixel(0,0,[Drawing.Color]::Red); '+
  ['$bitmap.Save('+quote(path.join(first,'picture.png'))+',[Drawing.Imaging.ImageFormat]::Png)',
   '$bitmap.Save('+quote(path.join(first,'photo.jpeg'))+',[Drawing.Imaging.ImageFormat]::Jpeg)',
   '$bitmap.Save('+quote(path.join(first,'photo.jpg'))+',[Drawing.Imaging.ImageFormat]::Jpeg)',
   '$bitmap.Save('+quote(path.join(first,'animation.gif'))+',[Drawing.Imaging.ImageFormat]::Gif)',
   '$bitmap.Dispose()',
   'New-Item -ItemType Junction -Path '+quote(path.join(first,'escape'))+' -Target '+quote(outside)+' | Out-Null'].join('; ');
const setupResult=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(setup,'utf16le').toString('base64')],
  {encoding:'utf8',windowsHide:true,env:{...process.env,TEMP:path.join(root,'tmp'),TMP:path.join(root,'tmp')}});
assert.equal(setupResult.status,0,setupResult.stderr);
const snapshot={version:1,activeTabId:'tab-1',nextTabSeq:3,engineMode:'engine-a',splitLayout:'split',showLineNumbers:true,
  tabs:[first,second].map((dir,i)=>({id:'tab-'+(i+1),title:'Document-'+(i+1)+'.md',filePath:path.join(dir,'document.md'),
    lastSavedMtime:0,isDirty:true,markdown:common,selectionStart:0,selectionEnd:0,editorScrollTop:0,previewScrollTop:0}))};
await fs.writeFile(path.join(data,'.cache','session.json'),JSON.stringify(snapshot));
const child=spawn(exe,[],{windowsHide:false,env:{...process.env,LITEMD_DATA_DIR:data,WEBVIEW2_USER_DATA_FOLDER:profile,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9241',TEMP:path.join(root,'tmp'),TMP:path.join(root,'tmp')}});
const exited=new Promise(resolve=>child.once('exit',resolve));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let ws,engine='a';const tests=[],requests=[],logs=[];
try{
  let target;
  for(let i=0;i<300;i++){try{target=(await fetch('http://127.0.0.1:9241/json/list').then(r=>r.json())).find(t=>t.type==='page'&&t.url.includes('tauri.localhost'));}catch{}if(target)break;await sleep(50);}
  assert(target,'Native WebView2 endpoint unavailable');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0;const pending=new Map();
  ws.onmessage=({data})=>{
    const m=JSON.parse(data);
    if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);
    if(m.method==='Log.entryAdded')logs.push(m.params.entry.text);
    const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}
  };
  function send(method,params={}){return new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout '+method));},30000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});}
  async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result?.value;}
  async function wait(expression){for(let i=0;i<160;i++){if(await evaluate(expression))return;await sleep(50);}throw new Error('Native condition timed out: '+expression);}
  await wait("!!document.body&&!document.body.inert&&document.querySelector('#tabbar')?.children.length>=2");
  await send('Network.enable');await send('Log.enable');
  await evaluate("window.__imageCommands=[];window.__xss=0;const old=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=(cmd,args,options)=>{if(cmd.includes('document_images'))window.__imageCommands.push(cmd);return old(cmd,args,options);}");
  const webp=await evaluate("(()=>{const c=document.createElement('canvas');c.width=2;c.height=2;return c.toDataURL('image/webp').split(',')[1]})()");
  await fs.writeFile(path.join(first,'photo.webp'),Buffer.from(webp,'base64'));
  const rootExpression=()=> "document.getElementById('"+(engine==='a'?'preview-sheet':'inline-canvas')+"')";
  async function set(markdown){
    await evaluate("(()=>{const ta=document.querySelector('#inline-canvas .litemd-inline-textarea');if(ta)ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));const e=document.querySelector('#editor-textarea');e.value="+JSON.stringify(markdown)+";e.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await sleep(50);
  }
  async function state(expression){return evaluate('((root)=>('+expression+'))('+rootExpression()+')');}
  async function test(name,run){
    try{await run();tests.push({engine,name,passed:true});console.log('PASS '+engine+' '+name);}
    catch(error){tests.push({engine,name,passed:false,error:String(error.stack||error)});console.log('FAIL '+engine+' '+name+': '+error.message);
      const shot=await send('Page.captureScreenshot',{format:'png'}).catch(()=>null);if(shot)await fs.writeFile(path.join(root,'failure-'+tests.length+'.png'),Buffer.from(shot.data,'base64'));}
    await fs.writeFile(path.join(root,'results.json'),JSON.stringify({exe,tests,requests,logs},null,2));
  }
  for(engine of ['a','b']){
    if(engine==='b')await evaluate("document.querySelector('#btn-engine-b').click()");
    await evaluate("document.querySelector('[data-tab-id=\"tab-1\"]').click()");
    await test('SVG, subdirectory, spaces, Unicode, PNG, JPEG, GIF and WebP decode natively',async()=>{
      await set(['![SVG](./plot.svg)','![Sub](figures/plot.svg)','![Unicode](./figures/גרף עם רווח.svg)','![PNG](picture.png)','![JPEG](photo.jpeg)','![JPG](photo.jpg)','![GIF](animation.gif)','![WebP](photo.webp)'].join('\n\n'));
      await wait('Array.from('+rootExpression()+".querySelectorAll('img')).length===8&&Array.from("+rootExpression()+".querySelectorAll('img')).every(i=>i.complete&&i.naturalWidth>0)");
      assert.deepEqual(await state("Array.from(root.querySelectorAll('img')).map(i=>i.naturalWidth)"),[120,80,95,8,8,8,8,2]);
    });
    await test('missing, absolute, traversal, encoded traversal, wrong format and junction escapes fail safely',async()=>{
      for(const ref of ['missing.svg','../outside/plot.svg','..%2foutside%2fplot.svg','escape/plot.svg','wrong.png','C:/private.png','file:///D:/private.svg']){
        await set('![Unavailable]('+ref+')');
        await wait("!"+rootExpression()+".querySelector('img') || !"+rootExpression()+".querySelector('img').hasAttribute('data-litemd-image') || "+rootExpression()+".querySelector('img').classList.contains('litemd-image-unavailable')");
        assert.equal(await state("Array.from(root.querySelectorAll('img')).some(i=>i.naturalWidth>0)"),false,ref);
      }
      await assert.rejects(evaluate("window.__TAURI_INTERNALS__.invoke('sync_document_images',{owner:'unauthorized-test',documentPath:'D:/not-selected.md',references:['plot.svg']})"));
    });
    await test('SVG stays an image and cannot execute scripts or fetch external subresources',async()=>{
      const requestStart=requests.length;
      await set('![Safe SVG context](attack.svg)');await wait(rootExpression()+".querySelector('img')?.naturalWidth===40");await sleep(100);
      assert.equal(await state("root.querySelectorAll('svg,script').length"),0);
      assert(!requests.slice(requestStart).some(url=>url.includes('attacker.invalid')));
    });
    await test('small, semantic figures and mathematics coexist',async()=>{
      await set('Normal $x_1^2$.\n\n<figure>\n<img src="./plot.svg" alt="Math $x^2$" onerror="window.__xss=1">\n<figcaption><small>Figure 1. $y_2^2$</small></figcaption>\n</figure>\n\n<ul><li>[ ] Presentation list</li></ul>\n\nAfter $A^*A=I$.');
      await wait(rootExpression()+".querySelector('img')?.naturalWidth===120");
      const result=await state("({figures:root.querySelectorAll('figure').length,caption:root.querySelector('figcaption')?.textContent,small:parseFloat(getComputedStyle(root.querySelector('small')).fontSize),parent:parseFloat(getComputedStyle(root.querySelector('figcaption')).fontSize),math:root.querySelectorAll('.katex').length,alt:root.querySelector('img').alt,onerror:root.querySelector('img').getAttribute('onerror')})");
      assert.equal(result.figures,1);assert(result.small<result.parent);assert.equal(result.math,3);assert.equal(result.alt,'Math $x^2$');assert.equal(result.onerror,null);
      assert.equal(await state("root.querySelectorAll('input').length"),0);
    });
    await test('local images in footnotes retain their document authorization',async()=>{
      await set('Reference[^plot].\n\n[^plot]: ![Plot](./plot.svg)');
      await wait(rootExpression()+".querySelector('.litemd-footnotes img')?.naturalWidth===120");
    });
    await test('footnote-looking attribute text cannot expand into generated markup',async()=>{
      await set('<small title="Reference[^note]">Caption</small>\n\n[^note]: A note.');
      assert.equal(await state("root.querySelector('small')?.title"),'Reference[^note]');
      assert.equal(await state("root.querySelector('small')?.textContent"),'Caption');
    });
    await test('inline code in image alt text remains literal without internal placeholders',async()=>{
      await set('![Use `foo("x")`](plot.svg)');
      await wait(rootExpression()+".querySelector('img')?.naturalWidth===120");
      assert.equal(await state("root.querySelector('img')?.alt"),'Use foo("x")');
    });
    const banner='<style>\n.article-banner { background:#182032; border-left:8px solid #d92733; border-radius:8px; padding:20px; }\n\n.article-banner .eyebrow { color:#f1a0a7; font-size:13px; }\n.article-banner h1 { color:white; font-size:28px; }\n</style>\n\n<div class="article-banner">\n<p class="eyebrow">MATHEMATICAL ANALYSIS</p>\n<h1>Second Derivative</h1>\n<small>A mathematical exposition $x^2$</small>\n</div>\n\nOutside mathematics $x_1+y_2$.';
    await test('allowlisted styles and inline flex layout are isolated to the document',async()=>{
      const before=await evaluate("getComputedStyle(document.querySelector('#btn-open')).color");
      await set(banner);
      const result=await state("({background:getComputedStyle(root.querySelector('.article-banner')).backgroundColor,border:getComputedStyle(root.querySelector('.article-banner')).borderLeftWidth,size:getComputedStyle(root.querySelector('.article-banner h1')).fontSize,errors:root.querySelectorAll('.katex-error').length,nonce:!!root.querySelector('style')?.nonce})");
      assert.equal(result.background,'rgb(24, 32, 50)');assert.equal(result.border,'8px');assert.equal(result.size,'28px');assert.equal(result.errors,0);assert(result.nonce);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#btn-open')).color"),before);
      await set('<div style="display:flex;gap:12px;padding:8px;color:rgb(20,30,40)"><span>First</span><small>Second</small></div>');
      assert.equal(await state("getComputedStyle(root.querySelector('[data-litemd-presentation]')).display"),'flex');
    });
    await test('scripts, handlers, unsafe URLs and resource-loading CSS are blocked',async()=>{
      const before=await evaluate("({color:getComputedStyle(document.querySelector('#btn-open')).color,display:getComputedStyle(document.querySelector('#app')).display})");
      const requestStart=requests.length;
      await set('<style>@import "https://attacker.invalid/a.css"; @font-face{font-family:bad;src:url(https://attacker.invalid/font)} body,#app,.litemd-toolbar{display:none} .safe{position:fixed;z-index:9999;background:url(https://attacker.invalid/leak);color:green}</style>\n\n<div class="safe" onclick="window.__xss=2" style="background-image:url(https://attacker.invalid/x);position:fixed;color:green"><script>window.__xss=3</script><iframe src="https://attacker.invalid/frame"></iframe><img src="javascript:window.__xss=4" onerror="window.__xss=5"><small>Safe</small></div>');
      await sleep(150);
      assert.equal(await state("root.querySelectorAll('script,iframe,object,embed,link,form,input').length"),0);
      assert.equal(await state("Array.from(root.querySelectorAll('*')).some(e=>Array.from(e.attributes).some(a=>a.name.toLowerCase().startsWith('on')))"),false);
      assert.equal(await evaluate('window.__xss'),0);
      assert(!requests.slice(requestStart).some(url=>url.includes('attacker.invalid')));
      assert.deepEqual(await evaluate("({color:getComputedStyle(document.querySelector('#btn-open')).color,display:getComputedStyle(document.querySelector('#app')).display})"),before);
      assert.equal(await state("getComputedStyle(root.querySelector('.safe')).position"),'static');
    });
    await test('fenced HTML remains code and source-line mappings remain accurate',async()=>{
      await set('~~~html\n<small onclick="bad()">Literal</small>\n~~~\n\n# Following heading');
      assert.equal(await state("root.querySelector('pre')?.textContent.includes('<small')"),true);
      assert.equal(await state("root.querySelectorAll('small').length"),0);
      assert.equal(await state("Number(root.querySelector('h1')?.getAttribute('data-line'))"),4);
    });
    await test('conventional and mixed blockquote mathematics keep greater-than relations',async()=>{
      await set('> START\n>\n> \\[\n> x > y\n> \\]\n>\n> END\n\n> \\[\nx_1+x_2=y\n\\]');
      assert.equal(await state("root.querySelectorAll('.katex-error').length"),0);
      assert.equal(await state("root.querySelectorAll('.katex').length"),2);
      assert((await state("root.querySelector('.katex-html')?.textContent")).includes('>'));
    });
    await test('caption edits preserve unchanged image and unrelated equation nodes without image IPC',async()=>{
      const source='<figure><img src="./plot.svg"><figcaption>Caption alpha</figcaption></figure>\n\nUnchanged $x^2+y^2=z^2$.\n\nTail.';
      await set(source);await wait(rootExpression()+".querySelector('img')?.naturalWidth===120");await sleep(100);
      await evaluate("window.__keptImage="+rootExpression()+".querySelector('img');window.__keptMath="+rootExpression()+".querySelector('.katex');window.__imageCommands=[];");
      const requestStart=requests.length;
      await set(source.replace('Caption alpha','Caption beta'));
      assert.equal(await state("root.querySelector('img')===window.__keptImage"),true);
      assert.equal(await state("root.querySelector('.katex')===window.__keptMath"),true);
      assert.equal(await evaluate('window.__imageCommands.length'),0);
      assert(!requests.slice(requestStart).some(url=>url.includes('litemd-image.localhost')));
    });
    await test('a caption edit in a long mathematical document preserves all equation and image nodes',async()=>{
      const math=Array.from({length:120},(_,i)=>'## Section '+i+'\n\nLet $x_'+i+'^2+y^2=z^2$.\n\n\\[\\sum_{k=1}^{'+(i+2)+'}\\frac{x^2}{k^2\\pi^2}=S_'+i+'\\]').join('\n\n');
      const source='<style>.caption{color:#123456}</style>\n\n<figure><img src="plot.svg"><figcaption class="caption">Caption alpha</figcaption></figure>\n\n'+math;
      await set(source);await wait(rootExpression()+".querySelector('img')?.naturalWidth===120");
      assert.equal(await state("root.querySelectorAll('.katex').length"),240);
      await evaluate("window.__longMath=Array.from("+rootExpression()+".querySelectorAll('.katex'));window.__longImage="+rootExpression()+".querySelector('img');window.__imageCommands=[];");
      await set(source.replace('Caption alpha','Caption beta'));
      assert.equal(await state("Array.from(root.querySelectorAll('.katex')).every((node,i)=>node===window.__longMath[i])"),true);
      assert.equal(await state("root.querySelector('img')===window.__longImage"),true);
      assert.equal(await state("getComputedStyle(root.querySelector('.caption')).color"),'rgb(18, 52, 86)');
      assert.equal(await evaluate('window.__imageCommands.length'),0);
      await evaluate('delete window.__longMath;delete window.__longImage');
    });
    if(engine==='b')await test('an inline editor retains correct source ranges after preceding lines shift',async()=>{
      await set('First.\n\nEditable block.');
      const updated='First.\nExtra line.\n\nEditable block.';
      const actual=await evaluate("(()=>{document.querySelectorAll('#inline-canvas .litemd-inline-block')[1].click();const editor=document.querySelector('#editor-textarea');editor.value="+JSON.stringify(updated)+";editor.dispatchEvent(new Event('input',{bubbles:true}));const inline=document.querySelector('#inline-canvas .litemd-inline-textarea');inline.focus();inline.setSelectionRange(inline.value.length,inline.value.length);document.execCommand('insertText',false,'X');return editor.value})()");
      assert.equal(actual,updated+'X');
    });
    await test('identical references resolve against each tab directory',async()=>{
      await set(common);await wait(rootExpression()+".querySelector('img')?.naturalWidth===120");
      await evaluate("document.querySelector('[data-tab-id=\"tab-2\"]').click()");
      await wait(rootExpression()+".querySelector('img')?.naturalWidth===260");
      await evaluate("document.querySelector('[data-tab-id=\"tab-1\"]').click()");
      await wait(rootExpression()+".querySelector('img')?.naturalWidth===120");
    });
    await test('changed image files revalidate on tab activation without a background watcher',async()=>{
      await set(common);await wait(rootExpression()+".querySelector('img')?.naturalWidth===120");
      try {
      await fs.writeFile(path.join(first,'plot.svg'),svg(135));
      await evaluate("document.querySelector('[data-tab-id=\"tab-2\"]').click()");
      await wait(rootExpression()+".querySelector('img')?.naturalWidth===260");
      await evaluate("document.querySelector('[data-tab-id=\"tab-1\"]').click()");
      await wait(rootExpression()+".querySelector('img')?.naturalWidth===135");
      } finally {
      await fs.writeFile(path.join(first,'plot.svg'),svg(120));
      await evaluate("document.querySelector('[data-tab-id=\"tab-2\"]').click()");await sleep(100);
      await evaluate("document.querySelector('[data-tab-id=\"tab-1\"]').click()");
      await wait(rootExpression()+".querySelector('img')?.naturalWidth===120");
      }
    });
    await test('unsaved documents show a predictable placeholder and do not authorize a folder',async()=>{
      await evaluate("document.querySelector('#btn-new').click()");
      await set(common);await sleep(100);
      assert.equal(await state("root.querySelector('img')?.getAttribute('src')"),null);
      assert((await state("root.querySelector('img')?.title")).includes('Save'));
      await evaluate("window.confirm=()=>true;document.querySelector('#tabbar .litemd-tab.is-active [data-close-tab-id]').click()");
      await evaluate("document.querySelector('[data-tab-id=\"tab-1\"]').click()");
      await evaluate("window.dispatchEvent(new Event('beforeunload'))");
      const paths=await evaluate("JSON.parse(localStorage.getItem('litemd_session_v1')).tabs.map(t=>t.filePath)");
      assert.deepEqual(paths,[path.join(first,'document.md'),path.join(second,'document.md')]);
    });
    await test('HTTPS images retain their normal remote URL',async()=>{
      await set('![Remote](https://github.githubassets.com/favicons/favicon.png)');
      assert.equal(await state("root.querySelector('img')?.getAttribute('src')"),'https://github.githubassets.com/favicons/favicon.png');
      await wait(rootExpression()+".querySelector('img')?.naturalWidth>0");
    });
  }
  await test('hidden engine styles do not survive source removal in the other engine',async()=>{
    await evaluate("document.querySelector('#btn-engine-b').click()");engine='a';
    await set('<style>.switch-test{color:rgb(1,2,3)}</style>\n\n<div class="switch-test">Test</div>');
    assert.equal(await state("getComputedStyle(root.querySelector('.switch-test')).color"),'rgb(1, 2, 3)');
    await evaluate("document.querySelector('#btn-engine-b').click()");engine='b';
    await set('<div class="switch-test">Test</div>');
    assert.notEqual(await state("getComputedStyle(root.querySelector('.switch-test')).color"),'rgb(1, 2, 3)');
  });
  await test('an authorized file handle cannot be redirected through a replaced junction',async()=>{
    await set('![Race](figures/plot.svg)');await wait(rootExpression()+".querySelector('img')?.naturalWidth===80");
    const oldUrl=await state("root.querySelector('img').src");
    const move='Move-Item -LiteralPath '+quote(path.join(first,'figures'))+' -Destination '+quote(path.join(first,'figures-original'))+
      '; New-Item -ItemType Junction -Path '+quote(path.join(first,'figures'))+' -Target '+quote(outside)+' | Out-Null';
    // Both resolved move paths are fixed descendants of this script's unique fixture root.
    assert(path.resolve(first,'figures').startsWith(root+path.sep));assert(path.resolve(first,'figures-original').startsWith(root+path.sep));
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(move,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr);
    const raceUrl=new URL(oldUrl);raceUrl.searchParams.set('race','1');
    await evaluate("window.__raceImage=new Image();window.__raceImage.src="+JSON.stringify(raceUrl.href));
    await wait('window.__raceImage.complete');assert.equal(await evaluate('window.__raceImage.naturalWidth'),0);
  });
  if(engine==='b'){await evaluate("document.querySelector('#btn-engine-b').click()");engine='a';}
  await set('<style>.demo{background:#182032;color:white;padding:20px;border-left:8px solid #d92733}.demo h1{color:white}</style>\n\n<div class="demo"><h1>LiteMD presentation check</h1><small>Scoped HTML and CSS; offline mathematics $x_1^2+y_2^2=z^2$.</small></div>\n\n<figure><img src="plot.svg"><figcaption><small>Native SVG image, resolved relative to this document.</small></figcaption></figure>\n\n\\[\\boxed{\\sum_{k=1}^{n}k=\\frac{n(n+1)}{2}}\\]');
  await wait(rootExpression()+".querySelector('img')?.naturalWidth===120");
  const screenshot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(root,'native-final.png'),Buffer.from(screenshot.data,'base64'));
  await evaluate("window.confirm=()=>true;void window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'tauri://close-requested',payload:null})");
  await Promise.race([exited,sleep(10000).then(()=>{throw new Error('Native test app did not close');})]);
  console.log(tests.filter(t=>t.passed).length+'/'+tests.length+' native rendering checks passed.');
  assert(tests.every(t=>t.passed),'See results.json for native failures');
}finally{ws?.close();if(child.exitCode===null)child.kill();}
