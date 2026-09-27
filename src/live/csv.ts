export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (!quoted && !field) quoted = true;
      else if (quoted) quoted = false;
      else throw new Error(`Unexpected quote near character ${i + 1}.`);
    } else if (char === ',' && !quoted) { row.push(field.trim()); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim()); field = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error('A quoted field is not closed.');
  row.push(field.trim());
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

export function csvObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV needs a header and at least one data row.');
  if (rows.length > 201) throw new Error('Import at most 200 rows at a time.');
  const headers = rows[0].map(value => value.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  if (headers.some(value => !value) || new Set(headers).size !== headers.length) throw new Error('CSV headers must be named and unique.');
  return rows.slice(1).map((row, index) => {
    if (row.length !== headers.length) throw new Error(`Row ${index + 2} has ${row.length} columns; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((header, position) => [header, row[position]]));
  });
}
