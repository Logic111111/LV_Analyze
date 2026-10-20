import { useEffect, useRef } from 'react';
import { Chart } from 'chart.js/auto';

// `label` names the chart for screen readers (P5.10); the pages also print the key numbers.
export default function LineChart({ data, options, height = 90, label = '24-hour chart' }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current.getContext('2d'), { type: 'line', data, options });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [data, options]);

  return <canvas ref={canvasRef} height={height} role="img" aria-label={label}></canvas>;
}
