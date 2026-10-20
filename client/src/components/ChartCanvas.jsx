import { useEffect, useRef } from 'react';
import { Chart } from 'chart.js/auto';

// Any Chart.js chart type on a canvas, rebuilt when data/options change. `label` gives the canvas
// an accessible name; pages also print the key numbers as text, so nothing is chart-only.
export default function ChartCanvas({ type, data, options, height = 90, label }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current.getContext('2d'), { type, data, options });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [type, data, options]);

  return <canvas ref={canvasRef} height={height} role="img" aria-label={label}></canvas>;
}
