import type { Account, Ledger } from './types';
import type { Tab } from './WorkspaceNav';

const money = (value: number | string | null | undefined) => `S$${Number(value || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });

export function TodayDashboard({ account, ledger, busy, progress, onTab, onDelivery, onImport }: {
  account: Account | undefined; ledger: Ledger | null; busy: boolean; progress: string;
  onTab: (tab: Tab) => void; onDelivery: () => void; onImport: () => void;
}) {
  const deliveries = ledger?.deliveries || [];
  const suppliers = ledger?.suppliers || [];
  const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name || 'Supplier';
  const priceRises = (ledger?.itemStats || []).filter(s => s.first_price != null && s.last_price != null && Number(s.last_price) > Number(s.first_price)).length;
  const restock = (ledger?.restockInsights || []).filter(x => x.suggested_quantity != null && Number(x.suggested_quantity) > 0).length;
  const metrics = [
    { label: 'Spend this month', value: money(ledger?.monthSummary.total), caption: 'From recorded deliveries', icon: '↗', tab: 'orders' as Tab },
    { label: 'Deliveries', value: String(ledger?.monthSummary.delivery_count || 0), caption: 'Recorded this month', icon: '▤', tab: 'orders' as Tab },
    { label: 'Claims to recover', value: money(ledger?.claimsSummary.outstanding), caption: 'Outstanding shortages', icon: '◎', tab: 'orders' as Tab },
    { label: 'Price rises', value: String(priceRises), caption: 'Items above first paid price', icon: '⌁', tab: 'prices' as Tab }
  ];
  return <div className="dashboard">
    <section className="dashboard-hero" aria-labelledby="dashboard-title">
      <div className="dashboard-hero-copy"><p className="eyebrow">YOUR OUTLET WORKSPACE · SINGAPORE</p><h2 id="dashboard-title">Good to see you, {account?.name || 'shopkeeper'}.</h2><p>Place orders through WhatsApp, then track supplier replies, prices and stock here.</p></div>
      <div className="dashboard-hero-actions"><button className="hero-primary" onClick={() => onTab('orders')}>WhatsApp orders <span aria-hidden="true">→</span></button><button className="hero-secondary" onClick={() => onTab('ask')}>Ask your ledger <span aria-hidden="true">→</span></button></div>
    </section>
    <section className="dashboard-metrics" aria-label="Outlet summary">{metrics.map(metric => <button key={metric.label} className="metric-card" onClick={() => onTab(metric.tab)}><span className="metric-top"><span className="metric-icon" aria-hidden="true">{metric.icon}</span><span className="metric-label">{metric.label}</span><span className="metric-arrow" aria-hidden="true">↗</span></span><strong className="n">{metric.value}</strong><small>{metric.caption}</small></button>)}</section>
    <div className="dashboard-columns">
      <section className="workspace-panel"><div className="workspace-panel-head"><div><h3>Recent deliveries</h3><p>Your latest recorded purchases</p></div><button onClick={() => onTab('orders')}>View all <span aria-hidden="true">→</span></button></div>
        <div className="workspace-panel-body">{deliveries.slice(0, 4).map(d => <div className="activity-row" key={d.id}><div className="activity-avatar">{supplierName(d.supplier_id).slice(0,2).toUpperCase()}</div><div className="activity-main"><strong>{supplierName(d.supplier_id)}</strong><span>{date(d.delivered_on)} · {d.lines.length} {d.lines.length === 1 ? 'item' : 'items'}</span></div><b className="n">{money(d.lines.reduce((sum, line) => sum + Number(line.line_total), 0))}</b></div>)}{!deliveries.length && <div className="dashboard-empty"><span className="empty-symbol" aria-hidden="true">▤</span><strong>No deliveries recorded yet</strong><p>Record a delivery or import your history to see real purchasing activity.</p><button onClick={onDelivery}>Record a delivery →</button></div>}</div>
      </section>
      <section className="workspace-panel"><div className="workspace-panel-head"><div><h3>Where to focus</h3><p>Signals from your ledger</p></div><button onClick={() => onTab('insights')}>Open desk <span aria-hidden="true">→</span></button></div><div className="focus-list">
        <button onClick={() => onTab('insights')}><span className="focus-icon mint">◈</span><span><strong>{restock ? `${restock} restock ${restock === 1 ? 'suggestion' : 'suggestions'}` : 'Plan your next restock'}</strong><small>{restock ? 'Based on recent stock and usage records' : 'Add stock counts and usage to see timely advice'}</small></span><span className="focus-arrow">→</span></button>
        <button onClick={() => onTab('prices')}><span className="focus-icon amber">↗</span><span><strong>{priceRises ? `${priceRises} items cost more` : 'Keep supplier prices in view'}</strong><small>{priceRises ? 'Compared with the first recorded price' : 'See price changes as deliveries are recorded'}</small></span><span className="focus-arrow">→</span></button>
        <button onClick={() => onTab('ask')}><span className="focus-icon lilac">✦</span><span><strong>Ask for a purchasing brief</strong><small>Get a grounded summary of your records</small></span><span className="focus-arrow">→</span></button>
      </div></section>
    </div>
    {!account?.demo_seeded_at && <section className="sample-banner"><div><strong>Explore with sample data</strong><p>Import 59 prototype deliveries to see how the workspace works. Sample records stay in this outlet.</p>{progress && <p role="status">{progress}</p>}</div><button disabled={busy} onClick={onImport}>Import sample ledger</button></section>}
  </div>;
}
