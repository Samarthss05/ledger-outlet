import type { ReactNode } from 'react';

export type Tab = 'today' | 'orders' | 'prices' | 'insights' | 'suppliers' | 'ask';

const paths: Record<Tab, ReactNode> = {
  today: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-7h6v7"/></>,
  orders: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  prices: <><path d="M4 17 10 11l4 3 6-7"/><path d="M15 7h5v5"/></>,
  insights: <><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 16v-3m5 3V8m5 8v-5"/></>,
  suppliers: <><path d="M3 21V7l9-4 9 4v14z"/><path d="M3 10h18M8 21v-7h8v7"/></>,
  ask: <><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7z"/><path d="m19 18 .5 1.5L21 20l-1.5.5L19 22l-.5-1.5L17 20l1.5-.5z"/></>
};

const navItems: { value: Tab; label: string }[] = [
  { value: 'today', label: 'Today' }, { value: 'orders', label: 'Deliveries' },
  { value: 'prices', label: 'Prices' }, { value: 'insights', label: 'Market & stock' },
  { value: 'suppliers', label: 'Suppliers' }, { value: 'ask', label: 'Ask ledger' }
];

export function NavIcon({ name }: { name: Tab }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function WorkspaceNav({ tab, onSelect, variant }: { tab: Tab; onSelect: (value: Tab) => void; variant: 'side' | 'bottom' }) {
  return <nav className={variant === 'side' ? 'workspace-side-nav' : 'live-nav'} aria-label="Main navigation">
    {navItems.map(item => <button key={item.value} type="button" className={tab === item.value ? 'selected' : ''} aria-current={tab === item.value ? 'page' : undefined} aria-label={item.label} onClick={() => onSelect(item.value)}><NavIcon name={item.value}/><span>{variant === 'bottom' ? ({ insights:'Market', ask:'Ask' } as Partial<Record<Tab,string>>)[item.value] || item.label : item.label}</span></button>)}
  </nav>;
}
