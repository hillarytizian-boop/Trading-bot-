const API_BASE_URL = "https://trading-bot-lsnu.onrender.com";
import { useState, useEffect, useRef } from 'react';
export default function Chart({ priceHistory, signals }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      const rect = containerRef.current.getBoundingClientRect();
      setDimensions({ width: rect.width, height: rect.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!canvasRef.current || dimensions.width === 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = dimensions.width, h = Math.max(200, dimensions.height || 250);
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(42,171,238,0.08)');
    grad.addColorStop(1, 'rgba(42,171,238,0.01)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 4; i++) {
      const y = (h / 4) * (i + 1);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const prices = priceHistory || [];
    const sigs = signals || [];
    if (prices.length < 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for price data...', w/2, h/2);
      return;
    }

    const minP = Math.min(...prices) * 0.999;
    const maxP = Math.max(...prices) * 1.001;
    const range = maxP - minP || 1;
    const pad = 10;

    ctx.beginPath();
    ctx.strokeStyle = '#2AABEE';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(42,171,238,0.3)';
    ctx.shadowBlur = 10;
    prices.forEach((p, i) => {
      const x = pad + (i / (prices.length-1)) * (w - 2*pad);
      const y = h - pad - ((p - minP) / range) * (h - 2*pad);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Area fill
    ctx.beginPath();
    const lastX = pad + ((prices.length-1)/(prices.length-1)) * (w - 2*pad);
    const firstX = pad;
    ctx.moveTo(firstX, h - pad);
    prices.forEach((p, i) => {
      const x = pad + (i / (prices.length-1)) * (w - 2*pad);
      const y = h - pad - ((p - minP) / range) * (h - 2*pad);
      ctx.lineTo(x, y);
    });
    ctx.lineTo(lastX, h - pad);
    ctx.closePath();
    const areaGrad = ctx.createLinearGradient(0, 0, 0, h);
    areaGrad.addColorStop(0, 'rgba(42,171,238,0.15)');
    areaGrad.addColorStop(1, 'rgba(42,171,238,0)');
    ctx.fillStyle = areaGrad;
    ctx.fill();

    const curP = prices[prices.length-1];
    const lastY = h - pad - ((curP - minP) / range) * (h - 2*pad);
    ctx.fillStyle = '#2AABEE';
    ctx.font = '500 11px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('$' + curP.toFixed(2), w - pad, lastY - 6);

    sigs.forEach((sig, idx) => {
      const idxP = Math.round((idx / sigs.length) * (prices.length - 1));
      if (idxP >= prices.length) return;
      const x = pad + (idxP / (prices.length-1)) * (w - 2*pad);
      const y = h - pad - ((prices[idxP] - minP) / range) * (h - 2*pad);
      let color, sym;
      if (sig.signal === 'BUY') { color = '#4FCE5D'; sym = '▲'; }
      else if (sig.signal === 'SELL') { color = '#FF5E5E'; sym = '▼'; }
      else { color = '#F0B429'; sym = '◆'; }
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 15;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0E1621';
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.font = '500 8px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(sym, x, y - 10);
    });

    const items = [
      { label: 'BUY', color: '#4FCE5D' },
      { label: 'SELL', color: '#FF5E5E' },
      { label: 'HOLD', color: '#F0B429' },
    ];
    const lx = 12, ly = h - 16;
    ctx.font = '500 9px Inter, sans-serif';
    ctx.textAlign = 'left';
    items.forEach((item, i) => {
      const x = lx + i * 70;
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(x + 6, ly, 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(item.label, x + 14, ly + 3);
    });
  }, [dimensions, priceHistory, signals]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 200 }}><canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} /></div>;
}
