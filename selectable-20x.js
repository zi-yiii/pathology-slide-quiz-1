/* 自由選點的 20×：只傳相對分塊座標；公開程式沒有學校網址或來源 GUID。 */
window.Detail20x = (() => {
  const $ = id => document.getElementById(id);
  const dialog = document.createElement('dialog');
  dialog.id = 'detailbox';
  dialog.setAttribute('aria-label', '選取位置看 20×');
  dialog.innerHTML = `<div class="modalbar"><strong>選取位置看 20×</strong><button id="detail-close">關閉 ×</button></div>
    <p class="hint">點低倍圖選位置；右側顯示該位置的 20×。白色區域可能是組織外的玻片背景。</p>
    <div class="detail-grid"><div class="detail-low"><div class="detail-map"><img id="detail-map" alt="點選低倍圖選擇位置"><div id="detail-marker"></div></div></div>
    <div class="detail-high"><p id="detail-status" role="status"></p><canvas id="detail-canvas" width="1280" height="960" aria-label="所選位置 20× 影像"></canvas>
    <div class="detail-nav"><button id="detail-left" aria-label="20× 視野往左">←</button><button id="detail-up" aria-label="20× 視野往上">↑</button><button id="detail-down" aria-label="20× 視野往下">↓</button><button id="detail-right" aria-label="20× 視野往右">→</button><button id="detail-retry">重新載入</button></div></div></div>`;
  document.body.appendChild(dialog);
  let slide, cell, x, y, generation = 0, abort, tileSet;
  const W = 1280, H = 960;
  const images = new Map();
  const service = () => String(window.PATHOLOGY_IMAGE_SERVICE || '').replace(/\/$/, '');
  const available = s => !!(s?.selectable20x || (s?.highResolution && service()));
  const geometry = () => slide.selectable20x || slide.highResolution;

  function loadImage(url, signal) {
    if (images.has(url)) return Promise.resolve(images.get(url));
    return fetch(url, {signal}).then(async r => {
      if (r.status === 204) return null;
      if (!r.ok) throw new Error('影像暫時無法載入');
      const blob = await r.blob();
      const image = await createImageBitmap(blob);
      images.set(url, image);
      if (images.size > 100) {
        const first = images.keys().next().value;
        images.get(first).close(); images.delete(first);
      }
      return image;
    });
  }

  function updateMarker() {
    const g = geometry();
    const baseX = cell ? (cell.highBounds?.x ?? cell.c * g.width / slide.cols) : 0;
    const baseY = cell ? (cell.highBounds?.y ?? cell.r * g.height / slide.rows) : 0;
    const width = cell ? (cell.highBounds?.width ?? g.width / slide.cols) : g.width;
    const height = cell ? (cell.highBounds?.height ?? g.height / slide.rows) : g.height;
    const left = Math.max(baseX, x - W / 2), top = Math.max(baseY, y - H / 2);
    const right = Math.min(baseX + width, x + W / 2), bottom = Math.min(baseY + height, y + H / 2);
    $('detail-marker').style.cssText = `left:${(left-baseX)/width*100}%;top:${(top-baseY)/height*100}%;width:${Math.max(0,right-left)/width*100}%;height:${Math.max(0,bottom-top)/height*100}%`;
  }

  async function render() {
    abort?.abort(); abort = new AbortController();
    const current = ++generation, g = geometry(), canvas = $('detail-canvas'), ctx = canvas.getContext('2d');
    x = Math.max(0, Math.min(g.width, x)); y = Math.max(0, Math.min(g.height, y));
    updateMarker();
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    $('detail-status').textContent = '載入所選位置的 20×…';
    const left = Math.round(x - W / 2), top = Math.round(y - H / 2);
    const ox = g.offsetX || 0, oy = g.offsetY || 0, ts = g.tileSize;
    const tasks = [];
    for (let r = Math.floor((top+oy)/ts); r <= Math.floor((top+H-1+oy)/ts); r++) {
      for (let c = Math.floor((left+ox)/ts); c <= Math.floor((left+W-1+ox)/ts); c++) {
        if (r < 0 || c < 0 || r*ts-oy >= g.height || c*ts-ox >= g.width) continue;
        if (slide.selectable20x && !tileSet.has(`${r},${c}`)) continue;
        const url = slide.selectable20x ? `${slide.hiBase || `slides/${slide.id}/hi`}/r${r}c${c}.jpg` : `${service()}/tile/${slide.id}/${r}/${c}`;
        tasks.push(async () => {
          const image = await loadImage(url, abort.signal);
          if (current === generation && image) ctx.drawImage(image, c*ts-ox-left, r*ts-oy-top);
        });
      }
    }
    // 六條請求上限，切換選點時取消舊請求。
    let next = 0;
    const worker = async () => { while (next < tasks.length && current === generation) await tasks[next++](); };
    try {
      await Promise.all(Array.from({length: Math.min(6, tasks.length)}, worker));
      if (current !== generation) return;
      $('detail-status').textContent = `20× · 視野約 ${(W*g.mpp/1000).toFixed(2)} × ${(H*g.mpp/1000).toFixed(2)} mm`;
      // 白色比例尺底避免遮住切片細節；只依原始掃描的像素尺寸繪製。
      const length = 100 / g.mpp;
      ctx.fillStyle = '#ffffffdb'; ctx.fillRect(22, H-66, length+28, 48);
      ctx.fillStyle = '#111'; ctx.fillRect(36, H-36, length, 4);
      ctx.font = '20px sans-serif'; ctx.fillText('100 µm', 36, H-44);
    } catch (error) {
      if (current !== generation || error.name === 'AbortError') return;
      ++generation; abort.abort();
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,W,H);
      $('detail-status').textContent = '影像載入失敗，請按「重新載入」。未載入的影像不會當成正常白底。';
    }
  }

  $('detail-map').onclick = event => {
    const rect = event.currentTarget.getBoundingClientRect(), g = geometry();
    const fx = Math.max(0, Math.min(1, (event.clientX-rect.left)/rect.width));
    const fy = Math.max(0, Math.min(1, (event.clientY-rect.top)/rect.height));
    x = cell ? (cell.highBounds?.x ?? cell.c*g.width/slide.cols) + fx*(cell.highBounds?.width ?? g.width/slide.cols) : fx*g.width;
    y = cell ? (cell.highBounds?.y ?? cell.r*g.height/slide.rows) + fy*(cell.highBounds?.height ?? g.height/slide.rows) : fy*g.height;
    render();
  };
  for (const [id, dx, dy] of [['detail-left',-.5,0],['detail-right',.5,0],['detail-up',0,-.5],['detail-down',0,.5]]) {
    $(id).onclick = () => { x += dx*W; y += dy*H; render(); };
  }
  $('detail-retry').onclick = render;
  $('detail-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { ++generation; abort?.abort(); });
  return {
    available,
    open(s, c=null) {
      if (!available(s)) return;
      slide=s; cell=c; tileSet=new Set(s.selectable20x?.tiles || []);
      const g=geometry();
      x=c ? (c.highBounds?.x ?? c.c*g.width/s.cols) + .5*(c.highBounds?.width ?? g.width/s.cols) : .5*g.width;
      y=c ? (c.highBounds?.y ?? c.r*g.height/s.rows) + .5*(c.highBounds?.height ?? g.height/s.rows) : .5*g.height;
      $('detail-map').src=c ? `slides/${s.id}/r${c.r}c${c.c}.jpg` : `slides/${s.id}/overview.jpg`;
      $('detail-map').alt=c ? '點選此 3mm 格子的任意位置' : '點選整張玻片的任意位置';
      dialog.showModal(); render();
    }
  };
})();
