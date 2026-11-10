// Reproducible native benchmark. Isolated D: profiles; never opens a user's documents.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const exe = path.resolve(option('--exe', 'target/release/litemd.exe'));
const output = path.resolve(option('--output', '.cache/native-benchmark'));
const repeats = Number(option('--repeats', '5'));
const engine = option('--engine', 'engine-a');
await fs.mkdir(output, { recursive:true });
const plain = '# Ordinary Markdown benchmark\n\n' + Array.from({length:160},(_,i)=>
  'Paragraph '+i+'. Ordinary prose with **bold**, *emphasis*, and a short list of editing observations.').join('\n\n') + '\n\nEditable tail.';
const math = '# Substantial mathematical benchmark\n\n' + Array.from({length:120},(_,i)=>
  '## Section '+i+'\n\nLet $x_'+i+'^2+y^2=z^2$ and $A^*A=I$.\n\n\\[\n\\sum_{k=1}^{'+(i+2)+'}\\frac{x^2}{k^2\\pi^2}=S_'+i+'\n\\]').join('\n\n') + '\n\nEditable tail.';
function session(documents) {
  return {version:1,activeTabId:'tab-1',nextTabSeq:documents.length+1,engineMode:engine,splitLayout:'split',showLineNumbers:true,
    tabs:documents.map((markdown,i)=>({id:'tab-'+(i+1),title:'Benchmark-'+i+'.md',filePath:null,lastSavedMtime:0,isDirty:true,markdown,
      selectionStart:0,selectionEnd:0,editorScrollTop:0,previewScrollTop:0}))};
}
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
function memory(pid, profile) {
  const quoted="'"+profile.replaceAll("'","''")+"'";
  const command = '$all=Get-CimInstance Win32_Process; $byId=@{};foreach($p in $all){$byId[[int]$p.ProcessId]=$p};$ids=[Collections.Generic.HashSet[int]]::new(); [void]$ids.Add('+pid+'); foreach($p in $all){if($p.ProcessId -ne $PID -and $p.CommandLine -and $p.CommandLine.IndexOf('+quoted+',[StringComparison]::OrdinalIgnoreCase)-ge 0){[void]$ids.Add([int]$p.ProcessId)}}; do {$changed=$false; foreach($p in $all){if($p.ProcessId -ne $PID -and $ids.Contains([int]$p.ParentProcessId)-and $byId.ContainsKey([int]$p.ParentProcessId) -and $p.CreationDate -ge $byId[[int]$p.ParentProcessId].CreationDate -and $ids.Add([int]$p.ProcessId)){$changed=$true}}}while($changed); for($sample=0;$sample -lt 3;$sample++){@($ids|ForEach-Object {$taskProcessId=$_;$process=Get-Process -Id $taskProcessId -ErrorAction SilentlyContinue;if($process -and $byId.ContainsKey($taskProcessId) -and [Math]::Abs(($process.StartTime-$byId[$taskProcessId].CreationDate).TotalMilliseconds) -lt 1){$process}}|Select-Object ProcessName,Id,WorkingSet64,PrivateMemorySize64)|ConvertTo-Json -Compress;if($sample -lt 2){Start-Sleep -Milliseconds 150}}';
  const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,env:{...process.env,TEMP:path.join(output,'tmp'),TMP:path.join(output,'tmp')}});
  if(result.status!==0)throw new Error(result.stderr);
  const samples=result.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));
  assert.equal(samples.length,3);
  return samples.map(processes=>{
    assert(processes.every(p=>p.Id===pid||p.ProcessName.toLowerCase()===path.basename(exe,'.exe').toLowerCase()||p.ProcessName==='msedgewebview2'),'Unexpected memory-sample owner: '+JSON.stringify(processes));
    return {processCount:processes.length,workingSetBytes:processes.reduce((s,p)=>s+p.WorkingSet64,0),privateBytes:processes.reduce((s,p)=>s+p.PrivateMemorySize64,0),processes};
  });
}
let results=[];
if(args.includes('--resume')){
  try{results=JSON.parse(await fs.readFile(path.join(output,'results.json'),'utf8')).results;}catch{}
}
for(const [name,documents] of [['idle',['Editable tail.']],['plain',[plain]],['math',[math]],['three-tabs',[plain,math,plain.replace('Ordinary','Third')]]]){
  if(option('--scenario','all')!=='all'&&option('--scenario','all')!==name)continue;
  const data=path.join(output,name,'data'),profile=path.join(output,name,'webview2');
  await fs.mkdir(path.join(data,'.cache'),{recursive:true});await fs.mkdir(profile,{recursive:true});await fs.mkdir(path.join(output,'tmp'),{recursive:true});
  const profileWasFresh=(await fs.readdir(profile)).length===0;
  for(let iteration=0;iteration<repeats;iteration++){
    if(results.some(r=>r.scenario===name&&r.iteration===iteration))continue;
    await fs.writeFile(path.join(data,'.cache','session.json'),JSON.stringify(session(documents)));
    const started=Date.now();
    const child=spawn(exe,[],{windowsHide:false,env:{...process.env,LITEMD_DATA_DIR:data,WEBVIEW2_USER_DATA_FOLDER:profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9240',TEMP:path.join(output,'tmp'),TMP:path.join(output,'tmp')}});
    const exited=new Promise(resolve=>child.once('exit',resolve));
    let ws;
    try{
      let target;
      for(let i=0;i<2400;i++){
        assert(child.exitCode===null,'Native process exited before document readiness: '+child.exitCode);
        try{target=(await fetch('http://127.0.0.1:9240/json/list').then(r=>r.json())).find(t=>t.type==='page'&&t.url.includes('tauri.localhost'));}catch{}
        if(target)break; await sleep(25);
      }
      assert(target,'Native debugging endpoint did not start');
      ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
      let id=0;const pending=new Map();
      ws.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}};
      function send(method,params={}){return new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout: '+method+' '+(params.expression||'').slice(0,120)));},60000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});}
      async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result?.value;}
      for(let i=0;i<2400;i++){
        if(await evaluate("!!document.body && !document.body.inert && document.querySelector('#editor-textarea')?.value.endsWith('Editable tail.')"))break;
        await sleep(25);
      }
      const readyMs=Date.now()-started;
      const restored=await evaluate("document.querySelector('#editor-textarea')?.value.endsWith('Editable tail.')");
      if(!restored)await fs.writeFile(path.join(output,'failed-startup-'+name+'-'+iteration+'.json'),JSON.stringify(await evaluate("({url:location.href,state:document.readyState,html:document.documentElement.outerHTML.slice(0,4000)})"),null,2));
      assert(restored,'Benchmark fixture must restore');
      console.log(name+' '+(iteration+1)+': editor ready');
      const paint=await evaluate("({origin:performance.timeOrigin,paints:performance.getEntriesByType('paint').map(e=>({name:e.name,time:e.startTime}))})");
      await evaluate('document.fonts.ready.then(()=>true)');await sleep(1000);
      console.log(name+' '+(iteration+1)+': fonts ready');
      const memorySamples=memory(child.pid,profile);
      console.log(name+' '+(iteration+1)+': memory sampled');
      const originalLength=await evaluate('('+function(inline){
        if(inline){const blocks=document.querySelectorAll('#inline-canvas .litemd-inline-block');blocks[blocks.length-1].click();}
        const editor=document.querySelector(inline?'#inline-canvas .litemd-inline-textarea':'#editor-textarea'),original=editor.value;
        const root=document.querySelector(inline?'#inline-canvas':'#preview-sheet');
        window.__litemdBench={editor,original,root,node:root.querySelector('.katex')};
        editor.focus();editor.setSelectionRange(editor.value.length,editor.value.length);
        return editor.value.length;
      }.toString()+')('+JSON.stringify(engine==='engine-b')+')');
      const samples=[];
      for(let i=0;i<20;i++){
        const sample=await evaluate("(()=>{const start=performance.now();document.execCommand('insertText',false,'x');const elapsedMs=performance.now()-start;return {elapsedMs,length:window.__litemdBench.editor.value.length}})()");
        assert.equal(sample.length,originalLength+i+1,'Each measured native edit must actually be applied');
        samples.push(sample.elapsedMs);
        await sleep(25); // Pace outside WebView: occluded windows can suspend animation frames.
      }
      const edit=await evaluate('('+function(inline){
        const {editor,original,root,node}=window.__litemdBench;
        editor.setSelectionRange(0,editor.value.length);document.execCommand('insertText',false,original);
        const start=performance.now();
        if(inline)editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        const result={commitMs:performance.now()-start,unchangedMathNodeReused:!node||node===root.querySelector('.katex')};
        delete window.__litemdBench;return result;
      }.toString()+')('+JSON.stringify(engine==='engine-b')+')');
      edit.samplesMs=samples;
      const switches=[];
      if(documents.length>1)for(let i=0;i<12;i++){
        switches.push(await evaluate("(()=>{const tabs=[...document.querySelectorAll('#tabbar .litemd-tab')],start=performance.now();tabs["+((i+1)%documents.length)+"].click();return performance.now()-start})()"));
        await sleep(25);
      }
      await evaluate('document.fonts.ready.then(()=>true)');
      const record={scenario:name,engine,iteration,profile:iteration===0&&profileWasFresh?'fresh':'warm',readyMs,
        firstContentfulPaintMs:paint.origin-started+(paint.paints.find(p=>p.name==='first-contentful-paint')?.time??NaN),
        memory:memorySamples,memoryAfterSwitch:switches.length?memory(child.pid,profile):[],edit,tabSwitchMs:switches};
      results.push(record);await fs.writeFile(path.join(output,'results.json'),JSON.stringify({exe,repeats,results},null,2));
      await evaluate("window.confirm=()=>true;void window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'tauri://close-requested',payload:null})");
      await Promise.race([exited,sleep(10000).then(()=>{throw new Error('Native process did not close normally');})]);
      console.log(name+' '+(iteration+1)+'/'+repeats+': ready '+readyMs+' ms');
    }finally{ws?.close();if(child.exitCode===null)child.kill();}
    await sleep(300);
  }
}
console.log('Saved native measurements to '+path.join(output,'results.json'));
