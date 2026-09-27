const TABLE_ID = 'M213761';
export const SINGSTAT_SOURCE = `https://tablebuilder.singstat.gov.sg/table/TS/${TABLE_ID}`;

export type RetailReference = {
  seriesNo: number;
  name: string;
  period: string;
  observedOn: string;
  pricePerBase: number;
  baseUnit: 'kg' | 'l' | 'each';
  rawPrice: number;
  sourceName: string;
  sourceUrl: string;
};

function packSize(label: string): { quantity: number; baseUnit: RetailReference['baseUnit'] } | null {
  const match = label.match(/\((?:Per )?(\d+(?:\.\d+)?)?\s*(Kilogram|Gram|Litre|Liter|Millilitre|Each)\)/i);
  if (match) {
    const quantity = Number(match[1] || 1);
    const unit = match[2].toLowerCase();
    if (unit === 'kilogram') return { quantity, baseUnit: 'kg' };
    if (unit === 'gram') return { quantity: quantity / 1000, baseUnit: 'kg' };
    if (unit === 'litre' || unit === 'liter') return { quantity, baseUnit: 'l' };
    if (unit === 'millilitre') return { quantity: quantity / 1000, baseUnit: 'l' };
    if (unit === 'each') return { quantity, baseUnit: 'each' };
  }
  if (/Hen Eggs \(Per 10\)/i.test(label)) return { quantity: 10, baseUnit: 'each' };
  return null;
}

export async function fetchRetailReferences(): Promise<RetailReference[]> {
  const response = await fetch(`https://tablebuilder.singstat.gov.sg/api/table/tabledata/${TABLE_ID}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'LedgerOutlet/1.0' },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error('Official price feed unavailable.');
  const payload = await response.json() as { StatusCode?: number; Data?: { row?: { seriesNo: string; rowText: string; columns: { key: string; value: string }[] }[] } };
  if (payload.StatusCode !== 200 || !Array.isArray(payload.Data?.row)) throw new Error('Official price feed returned an invalid response.');
  return payload.Data.row.flatMap(row => {
    const pack = packSize(row.rowText);
    const latest = [...row.columns].reverse().find(column => Number.isFinite(Number(column.value)) && Number(column.value) > 0);
    if (!pack || !latest) return [];
    const period = latest.key.match(/^(\d{4})\s+([A-Za-z]{3})$/);
    const month = period ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(period[2]) + 1 : 0;
    if (!period || !month) return [];
    const rawPrice = Number(latest.value);
    return [{
      seriesNo: Number(row.seriesNo), name: row.rowText.replace(/\s*\([^)]*\)$/, ''),
      period: latest.key, observedOn: `${period[1]}-${String(month).padStart(2, '0')}-01`,
      pricePerBase: Math.round(rawPrice / pack.quantity * 1000) / 1000,
      baseUnit: pack.baseUnit, rawPrice,
      sourceName: 'Singapore Department of Statistics — average retail price',
      sourceUrl: SINGSTAT_SOURCE
    }];
  });
}
