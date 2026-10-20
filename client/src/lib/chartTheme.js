// Chart.js needs literal colour strings (not CSS var()), so the two themes' chart palettes are
// kept here in step with the --* custom properties in styles.css. Shared by every chart page.
export const CHART_PALETTES = {
  light: {
    axisColor: '#5B6B85', gridColor: '#E4E9F1', legendColor: '#17202E',
    seriesColors: ['#2563EB', '#7C3AED', '#16A34A', '#DC2626'],
    maxColor: '#DC2626', minColor: '#16A34A',
    phaseColors: { A: '#C2410C', B: '#2563EB', C: '#15803D' }
  },
  dark: {
    axisColor: '#7F94B5', gridColor: '#22304A', legendColor: '#DCE6F5',
    seriesColors: ['#4F8CFF', '#B25CFF', '#4FD98A', '#F0546A'],
    maxColor: '#F0546A', minColor: '#4FD98A',
    phaseColors: { A: '#FF9B71', B: '#4F8CFF', C: '#4FD98A' }
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
