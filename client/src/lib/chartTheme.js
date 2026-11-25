// Chart.js needs literal colour strings (not CSS var()), so the two themes' chart palettes are
// kept here in step with the --* custom properties in styles.css. Shared by every chart page.
export const CHART_PALETTES = {
  light: {
    axisColor: '#52627A', gridColor: '#E3E9F2', legendColor: '#0E1726',
    seriesColors: ['#1D5FD8', '#7C3AED', '#12643A', '#B01C2E'],
    maxColor: '#B01C2E', minColor: '#12643A',
    phaseColors: { A: '#C2410C', B: '#2563EB', C: '#15803D' }
  },
  dark: {
    axisColor: '#8EA0BA', gridColor: '#1A2638', legendColor: '#E6EDF7',
    seriesColors: ['#6CB8FF', '#B794FF', '#5BE49B', '#FF7A8A'],
    maxColor: '#FF7A8A', minColor: '#5BE49B',
    phaseColors: { A: '#FFA27F', B: '#6AA6FF', C: '#5BE49B' }
  }
};

// Axis/grid/legend colours for a Chart.js options object, for the current theme.
export function themedScales(palette, { xTitle, yTitle } = {}) {
  const axis = (title) => ({
    ticks: { color: palette.axisColor }, grid: { color: palette.gridColor },
    ...(title ? { title: { display: true, text: title, color: palette.axisColor } } : {})
  });
  return { x: axis(xTitle), y: axis(yTitle) };
}
