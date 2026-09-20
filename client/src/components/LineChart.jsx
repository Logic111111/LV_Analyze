import { useEffect, useRef } from 'react';
import { Chart } from 'chart.js/auto';

export default function LineChart({ data, options, height = 90 }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current.getContext('2d'), { type: 'line', data, options });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, options]);

  return <canvas ref={canvasRef} height={height}></canvas>;
}
