// ui.js — 平滑流式：Responses SSE + 平滑渲染器 + 預熱進度條 + 回退非流式（加強握手＆收尾）
(() => {
  const $id = (id) => document.getElementById(id);
  const $qs = (sel) => document.querySelector(sel);
  const getFormEl = () =>
    $qs('form#askForm') || $qs('form[data-form="ask"]') || $qs('form') || null;

  const els = {
    form: getFormEl(),
    name: $id('name'), birth: $id('birth'), mother: $id('mother'),
    mbti: $id('mbti'), question: $id('question'), lang: $id('langSelect'),
    result: $id('result'), summary: $id('summaryText'), answer: $id('answer'),
    err: $id('err'), askAnother: $id('askAnother'), reset: $id('reset'),
    progWrap: $id('progress'), progBar: $id('progressBar'),
    progPct: $id('progressPct'), progMsg: $id('progressMsg'),
  };

  // ---------- 進度條 ----------
  const setBar = (p) => {
    const pct = Math.max(0, Math.min(100, Math.floor(p)));
    if (els.progBar) els.progBar.style.width = pct + '%';
    if (els.progPct) els.progPct.textContent = pct + '%';
  };
  const barShow = (m = '初始化…') => {
    els.progWrap && (els.progWrap.hidden = false);
    setBar(0);
    els.progMsg && (els.progMsg.textContent = m);
  };
  const barFinish = (elapsed = 0) => {
    const start = parseInt(els.progPct?.textContent || '0') || 0;
    const D = 800, t0 = performance.now();
    (function anim(t){
      const k = Math.min(1, (t - t0) / D);
      setBar(start + (100 - start) * k);
      if (k < 1) requestAnimationFrame(anim);
      else els.progMsg && (els.progMsg.textContent = `完成（用時 ${(elapsed/1000).toFixed(1)} 秒）`);
    })(performance.now());
  };

  const showErr = (m)=>{ if(!els.err) alert(m); else { els.err.style.display='block'; els.err.textContent=m; } };
  const clrErr  = ()=>{ if(els.err){ els.err.style.display='none'; els.err.textContent=''; } };
  const resetView=()=>{ els.result&&(els.result.hidden=true); els.summary&&(els.summary.textContent=''); els.answer&&(els.answer.textContent=''); els.progWrap&&(els.progWrap.hidden=true); clrErr(); };

  const API_BASE=(window.API_BASE||'').replace(/\/+$/,'');
  // ⬇️ 將非流式逾時拉長（300s），避免長答案被我們自己 Abort
  const TIMEOUT =(window.API_TIMEOUT_MS||300000);

  // ---------- 平滑渲染器 ----------
  class SmoothWriter {
    constructor(el, {fps=45, minChunk=2, maxChunk=18} = {}) {
      this.el = el;
      this.fps = fps;
      this.minChunk = minChunk;
      this.maxChunk = maxChunk;
      this.buf = '';
      this.timer = null;
      this.running = false;
    }
    push(text){ if(!text) return; this.buf += text; if(!this.running) this.loop(); }
    finishAll({ finalBoostTo=99 } = {}){
      return new Promise((resolve)=>{
        const left = this.buf.length;
        if (left === 0) { resolve(); return; }
        const steps = Math.max(3, Math.ceil(left / this.maxChunk));
        let i = 0;
        const tick = () => {
          if (i >= steps) { this.running=false; cancelAnimationFrame(this.timer); this.timer=null; resolve(); return; }
          const n = Math.ceil(left / steps);
          this._emitChunk(n);
          i++;
          this.timer = requestAnimationFrame(tick);
        };
        this.running = true;
        this.timer = requestAnimationFrame(tick);
        setBar(finalBoostTo);
      });
    }
    _emitChunk(n){
      if (this.buf.length === 0) return;
      const take = this._smartTake(n);
      if (!take) return;
      const prev = this.el.textContent || '';
      this.el.textContent = prev + take;
    }
    loop(){
      this.running = true;
      const interval = 1000 / this.fps;
      const tick = () => {
        if (this.buf.length === 0) { this.running = false; return; }
        const target = Math.min(this.maxChunk, Math.max(this.minChunk, Math.ceil(this.buf.length / 6)));
        this._emitChunk(target);
        this.timer = setTimeout(() => requestAnimationFrame(tick), interval);
      };
      requestAnimationFrame(tick);
    }
    _smartTake(n){
      if (this.buf.length <= n) { const all = this.buf; this.buf=''; return all; }
      const punct = /[，。！？、；：,.!?…）\]\}」』】]/;
      let cut = n;
      for (let i = n; i >= Math.max(1, n - 6); i--) {
        if (punct.test(this.buf[i-1])) { cut = i; break; }
      }
      const part = this.buf.slice(0, cut);
      this.buf = this.buf.slice(cut);
      return part;
    }
  }

  // ---------- 通用 fetch（非流式） ----------
  async function fetchJSON(path, opts={}, {timeoutMs=TIMEOUT}={}){
    const ctl=new AbortController(); const id=setTimeout(()=>ctl.abort(), timeoutMs);
    try{
      const res=await fetch(`${API_BASE}${path}`, {...opts, signal: ctl.signal});
      clearTimeout(id);
      const ct=res.headers.get('content-type')||'';
      const body=ct.includes('application/json')? await res.json().catch(()=>null) : await res.text().catch(()=> '');
      if(!res.ok){
        const text=typeof body==='string'?body:(body && (body.error||body.message)||'');
        throw new Error(`HTTP ${res.status} ${res.statusText}${text?`｜${String(text).slice(0,180)}`:''}`);
      }
      return (typeof body==='string')? {ok:true,answer:body}: body;
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  }

  // ---------- 真流式（SSE） ----------
  async function runStreaming(payload){
    const res=await fetch(`${API_BASE}/ask/stream`,{
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'text/event-stream'},
      body: JSON.stringify(payload),
      // keepalive 可減少頁面切換造成的中斷（瀏覽器支援則有效）
      keepalive: true
    });
    if(!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const reader=res.body.getReader(); const dec=new TextDecoder();
    let buf='', final=null, elapsed=0, live='';
    let bytesSeen=false; // ⬅️ 只要看到任何位元組，就代表握手成功
    let gotDelta=false;

    // 預熱/節奏控制
    let warmTimer=null, afterFirstTimer=null, currentPct=0;
    const startWarm = ()=>{ if(warmTimer) return; warmTimer=setInterval(()=>{ currentPct=Math.min(20,(currentPct||0)+0.5); setBar(currentPct); els.progMsg&&(els.progMsg.textContent='連線中…'); },200); };
    const stopWarm  = ()=>{ if(warmTimer){ clearInterval(warmTimer); warmTimer=null; } };
    const startAfterFirst = ()=>{ if(afterFirstTimer) return; afterFirstTimer=setInterval(()=>{ currentPct=Math.min(90,(currentPct||0)+1.2); setBar(currentPct); els.progMsg&&(els.progMsg.textContent='生成中…'); },150); };
    const stopAfterFirst  = ()=>{ if(afterFirstTimer){ clearInterval(afterFirstTimer); afterFirstTimer=null; } };

    // 平滑渲染器
    const writer = new SmoothWriter(els.answer, { fps: 45, minChunk: 2, maxChunk: 18 });

    // ⬇️ 握手逾時：10 秒內完全沒資料才視為失敗
    const handshake=new Promise((_,rej)=>setTimeout(()=>{
      if(!bytesSeen) rej(new Error('SSE-handshake-timeout'));
    },10000));

    const pump=(async ()=>{
      els.result && (els.result.hidden=false);
      els.summary && (els.summary.textContent='（生成中…）');
      els.answer && (els.answer.textContent='');

      while(true){
        const {value,done}=await reader.read(); if(done) break;
        if(value && value.length) bytesSeen=true; // ⬅️ 有任何資料就算成功
        buf += dec.decode(value,{stream:true});

        let idx;
        while((idx=buf.indexOf('\n\n'))>=0){
          const raw=buf.slice(0,idx).trim(); buf=buf.slice(idx+2); if(!raw) continue;
          let ev='message', data='';
          for(const line of raw.split('\n')){
            if(line.startsWith('event:')) ev=line.slice(6).trim();
            else if(line.startsWith('data:')) data += line.slice(5).trim();
          }

          if(ev==='progress'){
            try{
              const j=JSON.parse(data);
              startWarm();
              if(typeof j.pct==='number'){ currentPct=j.pct; setBar(Math.min(95,j.pct)); }
            }catch{}
          }
          else if(ev==='delta'){
            if(!gotDelta){ gotDelta=true; stopWarm(); startAfterFirst(); }
            try{
              const j=JSON.parse(data);
              if(j.delta){
                live += j.delta;
                writer.push(j.delta);
                currentPct=Math.min(90,Math.max(currentPct,(live.length/3500)*90));
                setBar(currentPct);
              }
            }catch{}
          }
          else if(ev==='final'){
            try{
              const j=JSON.parse(data);
              final=j; if(typeof j.elapsed_ms==='number') elapsed=j.elapsed_ms;
              setBar(99); els.progMsg && (els.progMsg.textContent='收尾中…');
            }catch{}
          }
        }
      }
      stopWarm(); stopAfterFirst();
      if(!final) throw new Error('stream finished without final payload');
      return { final, elapsed, writer };
    })();

    return await Promise.race([pump, handshake]);
  }

  // ---------- Submit ----------
  async function onSubmit(ev){
    ev?.preventDefault?.(); clrErr(); resetView();
    const name=els.name?.value?.trim(), birth=els.birth?.value, question=els.question?.value?.trim();
    if(!name) return showErr('請輸入姓名'); if(!birth) return showErr('請選擇生日'); if(!question) return showErr('請輸入你的問題');

    const payload={
      name, birth,
      mother_name: els.mother?.value?.trim() || undefined,
      lang: els.lang?.value || 'zh-Hans',
      depth: 'deep',
      question,
      reasoning: 'high'
    };

    barShow();
    let anyTextShown = false;

    try{
      // 先試 Responses 串流
      try{
        const { final, elapsed, writer } = await runStreaming(payload);
        anyTextShown = true;
        if (writer) await writer.finishAll({ finalBoostTo: 99 });
        if(final && final.ok===false) throw new Error(final.answer || final.detail || '發生錯誤');
        const txt = (final && final.answer) ? String(final.answer) : '';
        if(els.summary){ const first = txt.split(/\n\s*\n/)[0] || ''; els.summary.textContent = first; }
        if(els.answer) els.answer.textContent = txt;
        barFinish(final?.elapsed_ms || elapsed || 0);
        return;
      }catch(e1){
        if (e1.message !== 'SSE-handshake-timeout') throw e1; // 真錯誤就拋出；握手逾時才回退
      }

      // 回退非流式
      const data = await fetchJSON('/ask', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      const txt = (data && data.answer) ? String(data.answer) : '（沒有產出文字）';
      els.result && (els.result.hidden=false);
      els.summary && (els.summary.textContent=(txt.split(/\n\s*\n/)[0]||''));
      els.answer && (els.answer.textContent='');

      const writer = new SmoothWriter(els.answer, { fps: 45, minChunk: 2, maxChunk: 22 });
      writer.push(txt);
      anyTextShown = true;
      await writer.finishAll({ finalBoostTo: 99 });
      barFinish(data.elapsed_ms||0);

    } catch (err) {
      // 若是 Abort 類錯誤，且畫面已有內容，就當作已完成收尾
      const msg = String(err?.message || err);
      if (/AbortError|aborted without reason/i.test(msg) && (els.answer?.textContent?.length || 0) > 0) {
        barFinish(0);
        return;
      }
      showErr(msg || '生成失敗，請稍後再試。');
    }
  }

  (getFormEl() || document).addEventListener('submit', onSubmit);
  els.reset?.addEventListener('click', ()=>{ resetView(); const f=getFormEl(); if(f&&typeof f.reset==='function') f.reset(); });
  els.askAnother?.addEventListener('click', (e)=>{ e.preventDefault(); resetView(); els.question?.focus(); });
})();
