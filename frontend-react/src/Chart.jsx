import { useState, useEffect, useRef } from 'react';
export default function Chart({ priceHistory, signals }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver(() => {
      const rect = containerRef.current.getBoundingClientRect();
      setDimensions({ width: rect.width, height: rect.height });
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);
  useEffect(() => {
    if (!canvasRef.current || dimensions.width === 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = dimensions.width;
    const height = Math.max(200, dimensions.height || 250);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(42,171,238,0.08)');
    gradient.addColorStop(0.5, 'rgba(42,171,238,0.02)');
    gradient.addColorStop(1, 'rgba(42,171,238,0.01)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 4; i++) {
      const y = (height / 4) * (i + 1);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    const prices = priceHistory || [];
    const signalData = signals || [];
    if (prices.length < 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for price data...', width / 2, height / 2);
      return;
    }
    const minPrice = Math.min(...prices) * 0.999;
    const maxPrice = Math.max(...prices) * 1.001;
    const range = maxPrice - minPrice || 1;
    const padding = 10;
    ctx.beginPath();
    ctx.strokeStyle = '#2AABEE';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(42,171,238,0.3)';
    ctx.shadowBlur = 10;
    prices.forEach((p, i) => {
      const x = padding + (i / (prices.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((p - minPrice) / range) * (height - 2 * padding);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    const lastX = padding + ((prices.length - 1) / (prices.length - 1)) * (width - 2 * padding);
    const firstX = padding;
    ctx.moveTo(firstX, height - padding);
    prices.forEach((p, i) => {
      const x = padding + (i / (prices.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((p - minPrice) / range) * (height - 2 * padding);
      ctx.lineTo(x, y);
    });
    ctx.lineTo(lastX, height - padding);
    ctx.closePath();
    const areaGrad = ctx.createLinearGradient(0, 0, 0, height);
    areaGrad.addColorStop(0, 'rgba(42,171,238,0.15)');
    areaGrad.addColorStop(1, 'rgba(42,171,238,0)');
    ctx.fillStyle = areaGrad;
    ctx.fill();
    const currentPrice = prices[prices.length - 1];
    const lastY = height - padding - ((currentPrice - minPrice) / range) * (height - 2 * padding);
    ctx.fillStyle = '#2AABEE';
    ctx.font = '500 11px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`$${currentPrice.toFixed(2)}`, width - padding, lastY - 6);
    signalData.forEach((signal, index) => {
      const signalIndex = Math.round((index / signalData.length) * (prices.length - 1));
      if (signalIndex >= prices.length) return;
      const x = padding + (signalIndex / (prices.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((prices[signalIndex] - minPrice) / range) * (height - 2 * padding);
      let color, symbol;
      if (signal.signal === 'BUY') { color = '#4FCE5D'; symbol = '▲'; }
      else if (signal.signal === 'SELL') { color = '#FF5E5E'; symbol = '▼'; }
      else { color = '#F0B429'; symbol = '◆'; }
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 15;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, 2 * Math.PI);
      ctx.fillStyle = '#0E1621';
      ctx.fill();
      ctx.fillStyle = color;
      ctx.font = '500 8px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(symbol, x, y - 10);
    });
    const legendY = height - 16;
    const legendX = 12;
    ctx.font = '500 9px Inter, sans-serif';
    ctx.textAlign = 'left';
    const items = [
      { label: 'BUY', color: '#4FCE5D' },
      { label: 'SELL', color: '#FF5E5E' },
      { label: 'HOLD', color: '#F0B429' },
    ];
    items.forEach((item, i) => {
      const x = legendX + i * 70;
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(x + 6, legendY, 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(item.label, x + 14, legendY + 3);
    });
  }, [dimensions, priceHistory, signals]);
  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 200 }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
