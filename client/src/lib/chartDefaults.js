import { Chart } from 'chart.js/auto';

// Chart.js look (UI stage 1), applied once for every chart: Inter type, thin lines with points
// shown on hover only (line datasets only — scatter/bubble keep their points), glass tooltips,
// and a faint gradient under single-series line charts that don't set their own fill.
Chart.defaults.font.family = "Inter, 'Segoe UI', sans-serif";
Chart.defaults.font.size = 11;

Object.assign(Chart.defaults.datasets.line, {
  borderWidth: 1.75,
  // A line of one or two points would vanish without its markers.
  pointRadius: (ctx) => (ctx.dataset?.data?.length <= 2 ? 3 : 0),
  pointHoverRadius: 4
});

Object.assign(Chart.defaults.plugins.tooltip, {
  backgroundColor: 'rgba(10,16,28,.92)',
  borderColor: 'rgba(148,178,214,.25)',
  borderWidth: 1,
  cornerRadius: 8,
  padding: 10,
  titleColor: '#E6EDF7',
  bodyColor: '#E6EDF7',
  titleFont: { family: "'IBM Plex Mono', monospace", weight: '600' },
  bodyFont: { family: "Inter, 'Segoe UI', sans-serif" }
});

const withAlpha = (hex, a) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

const filled = new WeakSet();
Chart.register({
  id: 'fiAreaGradient',
  beforeUpdate(chart) {
    if (chart.config.type !== 'line') return;
    const sets = chart.config.data?.datasets || [];
    if (sets.length !== 1) return;
    const ds = sets[0];
    if (filled.has(ds) || ds.fill !== undefined || typeof ds.borderColor !== 'string' || !withAlpha(ds.borderColor, 1)) return;
    filled.add(ds);
    const top = withAlpha(ds.borderColor, 0.18), bottom = withAlpha(ds.borderColor, 0);
    ds.fill = 'origin';
    ds.backgroundColor = (ctx) => {
      const area = ctx.chart.chartArea;
      if (!area) return bottom;
      const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
      g.addColorStop(0, top);
      g.addColorStop(1, bottom);
      return g;
    };
  }
});
