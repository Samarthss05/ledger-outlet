import { useState } from 'react';
import type { Item, Ledger } from './types';

export type CatalogView = 'items' | 'products' | 'suppliers';
const money = (value: number | null | undefined) => value == null ? 'No price yet' : `S$${Number(value).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function CatalogPanel({ ledger, view, onView, busy, onAddItem, onAddProduct, onAddSupplier, onEditItem, onToggleItem }: {
  ledger: Ledger; view: CatalogView; onView: (view: CatalogView) => void; busy: boolean;
  onAddItem: () => void; onAddProduct: () => void; onAddSupplier: () => void;
  onEditItem: (item: Item) => void; onToggleItem: (item: Item) => void;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const productById = new Map(ledger.products.map(product => [product.id, product]));
  const supplierById = new Map(ledger.suppliers.map(supplier => [supplier.id, supplier]));
  const filteredItems = ledger.items.filter(item => {
    if (status !== 'all' && item.active !== (status === 'active')) return false;
    const searchable = `${item.name} ${item.unit} ${supplierById.get(item.supplier_id)?.name || ''} ${productById.get(item.product_id)?.name || ''}`.toLocaleLowerCase();
    return searchable.includes(search.toLocaleLowerCase());
  });
  const hasPrerequisites = ledger.suppliers.length > 0 && ledger.products.length > 0;

  return <div className="catalog-workspace">
    <header className="catalog-heading"><div><p className="eyebrow">YOUR BUYING CATALOG</p><h2>Items & suppliers</h2><p>Keep the products you buy, supplier packs, and contacts in one place.</p></div></header>
    <nav className="catalog-nav" aria-label="Catalog sections">{([['items', 'Supplier items'], ['products', 'Products'], ['suppliers', 'Suppliers']] as const).map(([id, label]) => <button key={id} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => onView(id)}>{label}</button>)}</nav>

    {view === 'items' && <><div className="catalog-section-head"><div><h3>Supplier items</h3><p>Each item is a pack you can buy from a supplier. Its product match keeps price comparisons accurate.</p></div><button className="catalog-primary" onClick={onAddItem}>＋ Add item</button></div>
      {!hasPrerequisites && <div className="catalog-setup"><div><strong>Two things to add first</strong><p>Choose who supplies the item and the product you want to compare it with.</p></div><div>{!ledger.suppliers.length && <button onClick={onAddSupplier}>1. Add supplier →</button>}{!ledger.products.length && <button onClick={onAddProduct}>2. Add product →</button>}</div></div>}
      <div className="catalog-toolbar"><label className="visually-hidden" htmlFor="catalog-search">Search supplier items</label><input id="catalog-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search items or suppliers" /><label>Show <select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="active">Active items</option><option value="inactive">Inactive items</option><option value="all">All items</option></select></label></div>
      <div className="catalog-list">{filteredItems.map(item => { const product = productById.get(item.product_id); const supplier = supplierById.get(item.supplier_id); const stat = ledger.itemStats.find(row => row.item_id === item.id); return <article className="catalog-row" key={item.id}><div className="catalog-row-main"><div className="catalog-avatar">{item.name.slice(0, 2).toUpperCase()}</div><div><h4>{item.name} {!item.active && <span className="catalog-inactive">Inactive</span>}</h4><p>{supplier?.name || 'Supplier'} · 1 {item.unit}{item.base_quantity && product ? ` = ${Number(item.base_quantity)} ${product.base_unit} ${product.name}` : ' · pack size needs review'}</p>{item.aliases.length > 0 && <small>Also called {item.aliases.join(', ')}</small>}</div></div><div className="catalog-row-actions"><span>{money(stat?.last_price)}</span><button onClick={() => onEditItem(item)}>Edit</button><button disabled={busy} onClick={() => onToggleItem(item)}>{item.active ? 'Deactivate' : 'Reactivate'}</button></div></article>; })}{!filteredItems.length && <div className="catalog-empty"><strong>{ledger.items.length ? 'No items match this view' : 'No supplier items yet'}</strong><p>{ledger.items.length ? 'Try another search or status filter.' : 'Add a supplier and product, then add the pack you buy from that supplier.'}</p>{!ledger.items.length && <button onClick={onAddItem}>Add your first item →</button>}</div>}</div>
      <p className="catalog-footnote">Deactivate items you no longer buy. Past deliveries and prices stay in your ledger.</p>
    </>}

    {view === 'products' && <><div className="catalog-section-head"><div><h3>Products</h3><p>A product is the common name and unit used to compare items from different suppliers.</p></div><button className="catalog-primary" onClick={onAddProduct}>＋ Add product</button></div><div className="catalog-list">{ledger.products.map(product => <article className="catalog-row" key={product.id}><div className="catalog-row-main"><div className="catalog-avatar">{product.name.slice(0, 2).toUpperCase()}</div><div><h4>{product.name}</h4><p>{product.grade ? `${product.grade} · ` : ''}Compare per {product.base_unit}</p></div></div><span className="catalog-count">{ledger.items.filter(item => item.product_id === product.id).length} supplier items</span></article>)}{!ledger.products.length && <div className="catalog-empty"><strong>No products yet</strong><p>Create a product, then link a supplier item and its pack size.</p><button onClick={onAddProduct}>Add your first product →</button></div>}</div></>}

    {view === 'suppliers' && <><div className="catalog-section-head"><div><h3>Suppliers</h3><p>Keep contacts and the items each supplier sells together.</p></div><button className="catalog-primary" onClick={onAddSupplier}>＋ Add supplier</button></div><div className="catalog-list">{ledger.suppliers.map(supplier => { const stat = ledger.supplierStats.find(row => row.supplier_id === supplier.id); return <article className="catalog-row" key={supplier.id}><div className="catalog-row-main"><div className="catalog-avatar">{supplier.short_name.slice(0, 2).toUpperCase()}</div><div><h4>{supplier.name}</h4><p>{supplier.category || supplier.contact_name || 'Supplier'} · {ledger.items.filter(item => item.supplier_id === supplier.id).length} items</p></div></div><span className="catalog-count">{stat?.delivery_count || 0} deliveries</span></article>; })}{!ledger.suppliers.length && <div className="catalog-empty"><strong>No suppliers yet</strong><p>Add a supplier before recording items and deliveries.</p><button onClick={onAddSupplier}>Add your first supplier →</button></div>}</div></>}
  </div>;
}
