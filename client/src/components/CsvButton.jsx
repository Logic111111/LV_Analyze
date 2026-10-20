import { toCsv } from '../lib/exports.js';
import { downloadText, safeName } from '../lib/sld/export.js';

// "CSV" download for any table (P6.6). A UTF-8 byte-order mark is added so Excel opens accented
// and Sinhala/Tamil text correctly.
export default function CsvButton({ name, columns, rows, label = 'CSV' }) {
  return (
    <button type="button" className="mini" onClick={() => downloadText('﻿' + toCsv({ name, columns, rows }), safeName(name) + '.csv', 'text/csv;charset=utf-8')}
      aria-label={`Download "${name}" as CSV`} disabled={!rows || !rows.length}>{label}</button>
  );
}
