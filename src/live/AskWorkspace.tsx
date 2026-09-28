import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createConversation, deleteConversation, listConversations, loadConversation, saveActionResult, saveTurn, type Conversation, type ConversationMessage } from './conversations';
import { applyAssistantProposal, type AssistantProposal } from './assistantActions';
import type { Ledger, Product } from './types';

const suggestions = ['What needs restocking?', 'Compare supplier prices', 'How much do suppliers owe me?', 'Add a new supplier item'];
const shortDate = (value: string) => new Date(value).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });

export function AskWorkspace({ accountId, accountName, token, ledger, onLedgerChange }: { accountId: string; accountName: string; token: string; ledger: Ledger | null; onLedgerChange: () => Promise<void> }) {
  const [chats, setChats] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState<AssistantProposal | null>(null);
  const requestId = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentAccount = useRef(accountId);
  currentAccount.current = accountId;

  useEffect(() => {
    const current = ++requestId.current;
    setChats([]); setActiveId(null); setMessages([]); setQuestion(''); setError(''); setProposal(null); setLoading(true); setBusy(false); setPendingQuestion(''); setHistoryOpen(false);
    listConversations(accountId).then(async result => {
      if (requestId.current !== current) return;
      setChats(result.rows); setHasMore(result.hasMore);
      if (result.rows[0]) {
        const rows = await loadConversation(accountId, result.rows[0].id);
        if (requestId.current !== current) return;
        setActiveId(result.rows[0].id); setMessages(rows);
      }
    }).catch(cause => { if (requestId.current === current) setError(cause instanceof Error ? cause.message : 'Could not load chats.'); })
      .finally(() => { if (requestId.current === current) setLoading(false); });
    return () => { requestId.current++; };
  }, [accountId]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages.length, pendingQuestion]);

  const newChat = () => { requestId.current++; setActiveId(null); setMessages([]); setQuestion(''); setError(''); setProposal(null); setHistoryOpen(false); setLoading(false); setLoadingThread(false); };
  const openChat = async (chat: Conversation) => {
    if (busy || chat.id === activeId) { setHistoryOpen(false); return; }
    const current = ++requestId.current;
    setLoadingThread(true); setError(''); setProposal(null); setHistoryOpen(false);
    try {
      const rows = await loadConversation(accountId, chat.id);
      if (requestId.current !== current) return;
      setActiveId(chat.id); setMessages(rows); setQuestion('');
    } catch (cause) { if (requestId.current === current) setError(cause instanceof Error ? cause.message : 'Could not open chat.'); }
    finally { if (requestId.current === current) setLoadingThread(false); }
  };

  const ask = async (text: string, action: 'ask' | 'brief' = 'ask') => {
    const prompt = text.trim();
    if (busy || prompt.length < 2) return;
    setBusy(true); setPendingQuestion(prompt); setError('');
    let answer = ''; let evidence: string[] = []; let nextId = activeId; let nextProposal: AssistantProposal | null = null;
    try {
      const response = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, accountId, ...(action === 'ask' ? { question: prompt, ...(activeId ? { conversationId: activeId } : {}) } : {}) }) });
      const result = await response.json() as { answer?: string; brief?: string; evidence?: string[]; proposal?: AssistantProposal; error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not answer that question.');
      if (currentAccount.current !== accountId) return;
      answer = result.answer || result.brief || '';
      if (!answer) throw new Error('The assistant returned an empty answer. Please try again.');
      evidence = Array.isArray(result.evidence) ? result.evidence : [];
      nextProposal = result.proposal || null;
      if (!nextId) {
        const created = await createConversation(accountId, prompt.replace(/\s+/g, ' ').slice(0, 80));
        nextId = created.id; setActiveId(created.id); setChats(previous => [created, ...previous]);
      }
      const saved = await saveTurn(accountId, nextId, prompt, answer, evidence);
      if (currentAccount.current !== accountId) return;
      setMessages(previous => [...previous, ...saved.messages]);
      setProposal(nextProposal);
      setChats(previous => [saved.conversation, ...previous.filter(chat => chat.id !== saved.conversation.id)]);
      setQuestion(''); setHistoryOpen(false);
    } catch (cause) {
      if (currentAccount.current !== accountId) return;
      if (answer) {
        setMessages(previous => [...previous,
          { id: crypto.randomUUID(), role: 'user', body: prompt, evidence: [], sequence_no: Date.now() },
          { id: crypto.randomUUID(), role: 'assistant', body: answer, evidence, sequence_no: Date.now() + 1 }]);
        setProposal(nextProposal);
        setError('The answer appeared, but it could not be saved. Copy anything you need before leaving this chat.');
      } else setError(cause instanceof Error ? cause.message : 'Could not answer that question.');
    } finally { if (currentAccount.current === accountId) { setBusy(false); setPendingQuestion(''); } }
  };

  const confirmAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!proposal || !ledger || busy) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true); setError('');
    let result = '';
    try { result = await applyAssistantProposal(accountId, proposal, fields, ledger); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save that change.'); setBusy(false); return; }
    if (currentAccount.current !== accountId) return;
    setProposal(null);
    try { await onLedgerChange(); }
    catch { setError(`${result} Reload the page to refresh your catalog.`); }
    if (activeId) {
      try { const saved = await saveActionResult(accountId, activeId, result); setMessages(previous => [...previous, saved]); }
      catch {
        setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'assistant', body: result, evidence: [], sequence_no: Date.now() }]);
        setError(`${result} The confirmation could not be saved to chat history.`);
      }
    }
    setBusy(false);
  };

  const removeChat = async (chat: Conversation) => {
    if (busy) return;
    if (!window.confirm(`Delete “${chat.title}” and all its messages?`)) return;
    try {
      await deleteConversation(accountId, chat.id);
      setChats(previous => previous.filter(row => row.id !== chat.id));
      if (chat.id === activeId) newChat();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete chat.'); }
  };
  const loadOlder = async () => {
    try {
      const result = await listConversations(accountId, chats.length);
      setChats(previous => [...previous, ...result.rows]); setHasMore(result.hasMore);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load older chats.'); }
  };

  const shown = chats.filter(chat => chat.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const active = chats.find(chat => chat.id === activeId);
  return <div className="ask-workspace ask-workspace-v2">
    <header className="ask-page-head"><div><p className="eyebrow">LEDGER ASSISTANT</p><h2>Ask your ledger</h2><p>Ask about {accountName}'s records or tell the assistant what to update.</p></div><button className="ask-new" onClick={newChat} disabled={busy}>＋ New chat</button></header>
    <div className="ask-mobile-history"><button onClick={() => setHistoryOpen(value => !value)} aria-expanded={historyOpen}>{historyOpen ? '← Back to chat' : `☰ Chats${chats.length ? ` (${chats.length})` : ''}`}</button><span>{active?.title || 'New conversation'}</span></div>
    {error && <div className="ask-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss message">×</button></div>}
    <div className={`ask-chat-layout ${historyOpen ? 'show-history' : ''}`}>
      <aside className="ask-history" aria-label="Conversation history"><div className="ask-history-heading"><strong>Conversations</strong><small>{chats.length} saved</small></div><label className="visually-hidden" htmlFor="ask-history-search">Search chats</label><input id="ask-history-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search chats" />
        <div className="ask-history-list">{loading ? <p className="muted">Loading chats…</p> : shown.length ? shown.map(chat => <div className={`ask-history-row ${chat.id === activeId ? 'active' : ''}`} key={chat.id}><button className="ask-history-open" onClick={() => void openChat(chat)} aria-current={chat.id === activeId ? 'page' : undefined}><span>{chat.title}</span><small>{shortDate(chat.updated_at)}</small></button><button className="ask-history-delete" title={`Delete ${chat.title}`} aria-label={`Delete ${chat.title}`} onClick={() => void removeChat(chat)}>×</button></div>) : <p className="muted">{search ? 'No matching chats.' : 'Your conversations will appear here after your first answer.'}</p>}</div>
        {hasMore && !search && <button className="ask-older" onClick={() => void loadOlder()}>Load older chats</button>}
      </aside>
      <section className="ask-chat-main" aria-label="Ledger conversation"><div className="ask-thread-top"><div><span className="ai-spark small" aria-hidden="true">✦</span><div><strong>{active?.title || 'New conversation'}</strong><small>Ledger records · {accountName}</small></div></div><div className="ask-thread-actions">{active && <span className="ask-saved">Saved</span>}{messages.length > 0 && <button type="button" className="ask-brief-shortcut" title="Generate morning brief" aria-label="Generate morning brief" disabled={busy} onClick={() => void ask('Generate my morning brief', 'brief')}>✦ <span>Morning brief</span></button>}</div></div>
        <div className="ask-thread-scroll" ref={scrollRef} aria-live="polite">{loading || loadingThread ? <p className="muted">Loading conversation…</p> : messages.length === 0 && !pendingQuestion ? <div className="ask-start"><span className="chat-mark" aria-hidden="true">✦</span><h3>What would you like to do?</h3><p>Ask about your outlet or tell me to add and update catalog records. You review every change before it is saved.</p><div className="ask-start-suggestions">{suggestions.map(text => <button key={text} disabled={busy} onClick={() => void ask(text)}>{text}<span aria-hidden="true">↗</span></button>)}</div><button className="ask-brief-link" disabled={busy} onClick={() => void ask('Generate my morning brief', 'brief')}>✦ Generate morning brief</button></div> : <>{messages.map(entry => <div className={`chat-turn ${entry.role}`} key={entry.id}><span className="chat-turn-avatar" aria-hidden="true">{entry.role === 'assistant' ? '✦' : 'Y'}</span><div className="chat-turn-body"><strong>{entry.role === 'assistant' ? 'Ledger assistant' : 'You'}</strong><p>{entry.body}</p>{entry.role === 'assistant' && entry.evidence?.length ? <details className="chat-evidence"><summary>Supporting records</summary><ul>{entry.evidence.map((line, index) => <li key={index}>{line}</li>)}</ul></details> : null}</div></div>)}{proposal && ledger && <ActionReview proposal={proposal} ledger={ledger} busy={busy} onConfirm={confirmAction} onCancel={() => setProposal(null)} />}{pendingQuestion && <><div className="chat-turn user"><span className="chat-turn-avatar" aria-hidden="true">Y</span><div className="chat-turn-body"><strong>You</strong><p>{pendingQuestion}</p></div></div><div className="chat-pending" role="status"><span className="chat-turn-avatar">✦</span>Checking your ledger…</div></>}</>}</div>
        <form className="ask-input" onSubmit={(event: FormEvent) => { event.preventDefault(); void ask(question); }}><label className="visually-hidden" htmlFor="ledger-question">Ask your ledger</label><textarea id="ledger-question" value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask or say ‘add Coke as an item’…" minLength={2} maxLength={500} required rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><div><span>Changes are reviewed before saving</span><button type="submit" disabled={busy || question.trim().length < 2} aria-label="Send question">↑</button></div></form>
      </section>
    </div>
  </div>;
}

function ActionReview({ proposal, ledger, busy, onConfirm, onCancel }: { proposal: AssistantProposal; ledger: Ledger; busy: boolean; onConfirm: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) {
  const [supplierId, setSupplierId] = useState(proposal.supplierId || (proposal.kind === 'create_item' && !ledger.suppliers.length ? '__new' : ''));
  const [productId, setProductId] = useState(proposal.productId || (ledger.products.length ? '' : '__new'));
  const [lineSlots, setLineSlots] = useState<number[]>(Array.from({ length: Math.max(1, proposal.deliveryLines?.length || 0) }, (_, index) => index));
  const item = ledger.items.find(row => row.id === proposal.itemId);
  const titles = { create_item: 'Add supplier item', edit_item: 'Edit supplier item', toggle_item: proposal.active ? 'Reactivate item' : 'Deactivate item', create_product: 'Add product', create_supplier: 'Add supplier', record_quote: 'Record supplier quote', record_stock: 'Record stock count', record_usage: 'Record usage or waste', set_lead_time: 'Set delivery lead time', record_delivery: 'Record delivery', update_claim: 'Update shortage claim' };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  return <section className="ask-action-card" aria-label="Review ledger action"><div className="ask-action-heading"><span className="ai-spark small" aria-hidden="true">✦</span><div><small>REVIEW ACTION</small><h3>{titles[proposal.kind]}</h3></div></div><p>Check the details. Your ledger changes only when you select Save.</p>
    <form onSubmit={onConfirm}>
      {proposal.kind === 'create_supplier' && <label>Supplier name<input name="name" defaultValue={proposal.name || ''} minLength={2} maxLength={160} required /></label>}
      {proposal.kind === 'create_product' && <><label>Product name<input name="name" defaultValue={proposal.name || ''} minLength={2} maxLength={160} required /></label><label>Comparison unit<select name="baseUnit" defaultValue={proposal.baseUnit || ''} required><option value="">Choose a unit</option><option value="kg">kg</option><option value="l">litre</option><option value="each">each</option></select></label><label>Category<input name="category" defaultValue={proposal.category || ''} maxLength={80} /></label><label>Grade or specification<input name="grade" defaultValue={proposal.grade || ''} maxLength={80} /></label></>}
      {proposal.kind === 'record_quote' && <><label>Supplier item<select name="itemId" defaultValue={proposal.itemId || ''} required><option value="">Choose an item</option>{ledger.items.filter(row => row.active).map(row => <option key={row.id} value={row.id}>{row.name} · {ledger.suppliers.find(supplier => supplier.id === row.supplier_id)?.name}</option>)}</select></label><div className="ask-action-pair"><label>Quoted date<input name="date" type="date" defaultValue={proposal.date || today} required /></label><label>Price per pack (SGD)<input name="price" type="number" min="0.01" step="0.01" defaultValue={proposal.price ?? ''} required /></label></div></>}
      {(proposal.kind === 'record_stock' || proposal.kind === 'record_usage') && <><label>Product<select name="productId" defaultValue={proposal.productId || ''} required><option value="">Choose a product</option>{ledger.products.map(row => <option key={row.id} value={row.id}>{row.name} · {row.base_unit}</option>)}</select></label><div className="ask-action-pair"><label>{proposal.kind === 'record_stock' ? 'Counted on' : 'Usage date'}<input name="date" type="date" defaultValue={proposal.date || today} required /></label><label>Quantity in product units<input name="quantity" type="number" min={proposal.kind === 'record_stock' ? '0' : '0.001'} step="0.001" defaultValue={proposal.quantity ?? ''} required /></label></div>{proposal.kind === 'record_usage' && <label>Type<select name="usageKind" defaultValue={proposal.usageKind || ''} required><option value="">Choose type</option><option value="used">Used or sold</option><option value="waste">Waste</option></select></label>}</>}
      {proposal.kind === 'set_lead_time' && <><label>Supplier<select name="supplierId" defaultValue={proposal.supplierId || ''} required><option value="">Choose a supplier</option>{ledger.suppliers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>Days from order to delivery<input name="leadDays" type="number" min="0" max="90" step="1" defaultValue={proposal.leadDays ?? ''} required /></label></>}
      {proposal.kind === 'update_claim' && <><label>Shortage claim<select name="claimId" defaultValue={proposal.claimId || ''} required><option value="">Choose a claim</option>{ledger.claims.map(row => <option key={row.id} value={row.id}>S${Number(row.amount).toFixed(2)} · {row.status} · {row.id.slice(0,8)}</option>)}</select></label><label>New status<select name="claimStatus" defaultValue={proposal.claimStatus || ''} required><option value="">Choose status</option><option value="open">Open</option><option value="asked">Asked supplier</option><option value="credited">Credited</option><option value="refused">Refused</option></select></label></>}
      {proposal.kind === 'record_delivery' && <><label>Supplier<select name="supplierId" value={supplierId} onChange={event => setSupplierId(event.target.value)} required><option value="">Choose a supplier</option>{ledger.suppliers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>Delivery date<input name="date" type="date" defaultValue={proposal.date || today} required /></label><p className="ask-action-hint">Confirm the ordered, delivered, and charged amounts separately. A shortage claim opens when charged exceeds delivered.</p>{lineSlots.map(index => { const line = proposal.deliveryLines?.[index]; return <div className="ask-delivery-line" key={index}><input type="hidden" name="lineIndex" value={index} /><div className="ask-delivery-line-head"><strong>Item {index + 1}</strong>{lineSlots.length > 1 && <button type="button" onClick={() => setLineSlots(previous => previous.filter(slot => slot !== index))}>Remove</button>}</div><label>Supplier item<select name={`lineItemId${index}`} defaultValue={line?.itemId || ''} required><option value="">Choose an item</option>{ledger.items.filter(row => row.supplier_id === supplierId && row.active).map(row => <option key={row.id} value={row.id}>{row.name} · {row.unit}</option>)}</select></label><div className="ask-delivery-numbers"><label>Ordered<input name={`lineOrdered${index}`} type="number" min="0" step="0.001" defaultValue={line?.quantityOrdered ?? ''} required /></label><label>Delivered<input name={`lineDelivered${index}`} type="number" min="0" step="0.001" defaultValue={line?.quantityDelivered ?? ''} required /></label><label>Charged<input name={`lineCharged${index}`} type="number" min="0" step="0.001" defaultValue={line?.quantityCharged ?? ''} required /></label><label>Price per pack<input name={`linePrice${index}`} type="number" min="0" step="0.01" defaultValue={line?.unitPrice ?? ''} required /></label></div></div>; })}<button type="button" className="ask-add-line" onClick={() => setLineSlots(previous => [...previous, Math.max(...previous) + 1])}>＋ Add item line</button></>}
      {(proposal.kind === 'create_item' || proposal.kind === 'edit_item') && <>
        {proposal.kind === 'create_item' ? <><label>Supplier<select name="supplierId" value={supplierId} onChange={event => setSupplierId(event.target.value)} required><option value="">Choose a supplier</option>{ledger.suppliers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}<option value="__new">＋ New supplier</option></select></label>{supplierId === '__new' && <label>New supplier name<input name="newSupplierName" minLength={2} maxLength={160} required placeholder="Supplier name" /></label>}</> : <div className="ask-action-fixed">Supplier <strong>{ledger.suppliers.find(row => row.id === item?.supplier_id)?.name || 'Unknown'}</strong></div>}
        <label>Comparable product<select name="productId" value={productId} onChange={event => setProductId(event.target.value)} required><option value="">Choose a product</option>{ledger.products.map(row => <option key={row.id} value={row.id}>{row.name} · {row.base_unit}</option>)}{proposal.kind === 'create_item' && <option value="__new">＋ New product</option>}</select></label>
        {productId === '__new' && proposal.kind === 'create_item' && <><label>New product name<input name="newProductName" defaultValue={proposal.name || ''} minLength={2} maxLength={160} required /></label><label>Compare new product per<select name="newBaseUnit" defaultValue={proposal.baseUnit || ''} required><option value="">Choose a unit</option><option value="kg">kg</option><option value="l">litre</option><option value="each">each</option></select></label></>}
        <label>Supplier item name<input name="name" defaultValue={proposal.name || ''} maxLength={160} required /></label><div className="ask-action-pair"><label>Pack unit<input name="unit" defaultValue={proposal.unit || ''} maxLength={30} required placeholder="carton, bottle, kg" /></label><label>Units in one pack<input name="baseQuantity" type="number" min="0.0001" max="1000000" step="0.0001" defaultValue={proposal.baseQuantity || ''} required placeholder="e.g. 24" /></label></div><label>Other names, comma separated<input name="aliases" defaultValue={proposal.aliases.join(', ')} /></label>
      </>}
      {proposal.kind === 'toggle_item' && <div className="ask-action-fixed">Item <strong>{item?.name || 'Unknown item'}</strong></div>}
      <div className="ask-action-controls"><button type="submit" disabled={busy}>{busy ? 'Saving…' : `Save ${proposal.kind === 'toggle_item' ? 'change' : 'to ledger'}`}</button><button type="button" onClick={onCancel} disabled={busy}>Cancel</button></div>
    </form>
  </section>;
}
