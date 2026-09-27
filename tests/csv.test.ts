import test from 'node:test';
import assert from 'node:assert/strict';
import { csvObjects, parseCsv } from '../src/live/csv.ts';

test('parses quoted commas, escaped quotes, CRLF, and BOM', () => {
  assert.deepEqual(csvObjects('\uFEFFProduct,Date,Quantity\r\n"Rice, Thai",2026-09-27,2\r\n"A ""special"" rice",2026-09-28,3'), [
    { product: 'Rice, Thai', date: '2026-09-27', quantity: '2' },
    { product: 'A "special" rice', date: '2026-09-28', quantity: '3' }
  ]);
});
test('rejects malformed rows and unclosed quotes', () => {
  assert.throws(() => csvObjects('a,b\n1'), /Row 2/);
  assert.throws(() => parseCsv('a,b\n"broken'), /not closed/);
});
