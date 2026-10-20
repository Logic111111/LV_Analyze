// Browser-side delivery of SLD exports (P5.1): file download, PNG via a canvas, and print-to-PDF
// through a hidden iframe (so the page's own print styles are untouched).

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text, filename, type) { downloadBlob(new Blob([text], { type }), filename); }

/** Rasterises an SVG document at `scale` × its own size. @returns {Promise<Blob>} */
export function svgToPng(svgText, scale = 2) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(img.width * scale); canvas.height = Math.ceil(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not render the SVG for PNG export')); };
    img.src = url;
  });
}

/** Opens the browser's print dialog for one SVG drawing (choose "Save as PDF" for a PDF). */
export function printSvg(svgText, title) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>
<style>@page{size:A3 landscape;margin:10mm}html,body{margin:0}svg{width:100%;height:auto;max-height:100vh}</style></head><body>${svgText}</body></html>`);
  doc.close();
  const go = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 1000);
  };
  // Give the iframe a tick to lay out before printing.
  setTimeout(go, 50);
}

export const safeName = (s) => String(s || 'design').replace(/[^\w.-]+/g, '_').slice(0, 60);
