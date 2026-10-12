import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createConversation, deleteConversation, listConversations, loadConversation, saveActionResult, saveTurn, type Conversation, type ConversationMessage } from './conversations';
import { applyAssistantProposal, type AssistantProposal } from './assistantActions';
import { deleteAgentMemory, listAgentMemories, type AgentMemory } from './memories';
import type { Ledger, Product } from './types';
import { chatOrderId, chatOrderRequest, type ChatOrderLine, type ChatOrderView } from './chatOrders';
import { ChatOrderCard } from './ChatOrderCard';

const suggestions = ['Order rice 2 bags tomorrow', 'Repeat my usual order', 'Find my biggest buying opportunity', 'What should I restock this week?'];
const shortDate = (value: string) => new Date(value).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
type MissingItemContext={orderId:string;lineIndex:number;rawText:string;draft:{lines:ChatOrderLine[];requestedDeliveryOn:string|null;deliveryNote:string}};

export function AskWorkspace({ accountId, accountName, token, ledger, onLedgerChange }: { accountId: string; accountName: string; token: string; ledger: Ledger | null; onLedgerChange: () => Promise<void> }) {
  const [chats, setChats] = useState<Conversation[]>([]);
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [proposals, setProposals] = useState<AssistantProposal[]>([]);
  const [missingItem, setMissingItem] = useState<MissingItemContext|null>(null);
  const [orders, setOrders] = useState<Record<string,ChatOrderView>>({});
  const requestId = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const requestKeyRef = useRef<{text:string;id:string}|null>(null);
  const currentAccount = useRef(accountId);
  currentAccount.current = accountId;

  useEffect(() => {
    const current = ++requestId.current;
    setChats([]); setMemories([]); setActiveId(null); setMessages([]); setOrders({}); setQuestion(''); setError(''); setProposals([]); setMissingItem(null); setLoading(true); setBusy(false); setPendingQuestion(''); setHistoryOpen(false); requestKeyRef.current=null;
    listAgentMemories(accountId).then(rows => { if (requestId.current === current) setMemories(rows); }).catch(cause => { if (requestId.current === current) setError(cause instanceof Error ? cause.message : 'Could not load outlet memory.'); });
    listConversations(accountId).then(async result => {
      if (requestId.current !== current) return;
      setChats(result.rows); setHasMore(result.hasMore);
      if (result.rows[0]) {
        const rows = await loadConversation(accountId, result.rows[0].id);
        if (requestId.current !== current) return;
        setActiveId(result.rows[0].id); setMessages(rows); void hydrateOrders(rows,current);
      }
    }).catch(cause => { if (requestId.current === current) setError(cause instanceof Error ? cause.message : 'Could not load chats.'); })
      .finally(() => { if (requestId.current === current) setLoading(false); });
    return () => { requestId.current++; };
  }, [accountId]);

  useEffect(() => {
    const frame=window.requestAnimationFrame(()=>{
      const scroller=scrollRef.current;
      if (!scroller) return;
      if (pendingQuestion) {scroller.scrollTo({top:scroller.scrollHeight,behavior:'smooth'});return;}
      const target=lastMessageRef.current;
      if (target) scroller.scrollTo({top:scroller.scrollTop+target.getBoundingClientRect().top-scroller.getBoundingClientRect().top-12,behavior:'smooth'});
    });
    return ()=>window.cancelAnimationFrame(frame);
  }, [messages.length,pendingQuestion]);
  useEffect(() => {
    if (!busy || !pendingQuestion) { setWaitingSeconds(0); return; }
    const started=Date.now();
    const timer=window.setInterval(() => setWaitingSeconds(Math.floor((Date.now()-started)/1000)),1000);
    return () => window.clearInterval(timer);
  }, [busy,pendingQuestion]);
  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = '0px';
    composer.style.height = `${Math.min(composer.scrollHeight, 160)}px`;
  }, [question]);

  const hydrateOrders = async (rows:ConversationMessage[],current:number) => {
    const ids=[...new Set(rows.map(row=>chatOrderId(row.evidence)).filter((id):id is string=>!!id))];
    if (!ids.length) return;
    try {
      const result=await chatOrderRequest<{orders:ChatOrderView[]}>(token,{accountId,action:'list',ids:ids.slice(0,40)});
      if (requestId.current===current) setOrders(previous=>({...previous,...Object.fromEntries(result.orders.map(order=>[order.id,order]))}));
    } catch (cause) { if (requestId.current===current) setError(cause instanceof Error?cause.message:'Could not load order cards.'); }
  };

  const newChat = () => { requestId.current++; requestKeyRef.current=null; setActiveId(null); setMessages([]); setQuestion(''); setError(''); setProposals([]); setMissingItem(null); setHistoryOpen(false); setLoading(false); setLoadingThread(false); };
  const openChat = async (chat: Conversation) => {
    if (busy || chat.id === activeId) { setHistoryOpen(false); return; }
    const current = ++requestId.current;
    setLoadingThread(true); setError(''); setProposals([]); setMissingItem(null); setHistoryOpen(false);
    try {
      const rows = await loadConversation(accountId, chat.id);
      if (requestId.current !== current) return;
      setActiveId(chat.id); setMessages(rows); setQuestion(''); void hydrateOrders(rows,current);
    } catch (cause) { if (requestId.current === current) setError(cause instanceof Error ? cause.message : 'Could not open chat.'); }
    finally { if (requestId.current === current) setLoadingThread(false); }
  };

  const ask = async (text: string, action: 'ask' | 'brief' = 'ask') => {
    const prompt = text.trim();
    if (busy || prompt.length < 2) return;
    if (!requestKeyRef.current || requestKeyRef.current.text!==prompt) requestKeyRef.current={text:prompt,id:crypto.randomUUID()};
    const requestId=requestKeyRef.current.id;
    const sentFromComposer = action === 'ask' && question.trim() === prompt;
    if (sentFromComposer) setQuestion('');
    setBusy(true); setPendingQuestion(prompt); setError('');
    let answer = ''; let evidence: string[] = []; let nextId = activeId; let nextProposals: AssistantProposal[] = []; let nextOrder:ChatOrderView|undefined;
    try {
      const currentOrderId=[...messages].reverse().map(message=>chatOrderId(message.evidence)).find((id):id is string=>Boolean(id));
      const response = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, accountId, ...(action === 'ask' ? { question: prompt, requestId, ...(currentOrderId ? { currentOrderId } : {}), ...(activeId ? { conversationId: activeId } : {}) } : {}) }) });
      const result = await response.json() as { answer?: string; brief?: string; evidence?: string[]; order?:ChatOrderView; proposals?: AssistantProposal[]; proposal?: AssistantProposal; error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not answer that question.');
      if (currentAccount.current !== accountId) return;
      answer = result.answer || result.brief || '';
      if (!answer) throw new Error('The assistant returned an empty answer. Please try again.');
      evidence = Array.isArray(result.evidence) ? result.evidence : [];
      nextOrder=result.order;
      if (nextOrder) setOrders(previous=>({...previous,[nextOrder!.id]:nextOrder!}));
      nextProposals = Array.isArray(result.proposals) ? result.proposals : result.proposal ? [result.proposal] : [];
      if (!nextId) {
        const created = await createConversation(accountId, prompt.replace(/\s+/g, ' ').slice(0, 80));
        nextId = created.id; setActiveId(created.id); setChats(previous => [created, ...previous]);
      }
      const saved = await saveTurn(accountId, nextId, prompt, answer, evidence);
      if (currentAccount.current !== accountId) return;
      setMessages(previous => [...previous, ...saved.messages]);
      setProposals(nextProposals);
      setChats(previous => [saved.conversation, ...previous.filter(chat => chat.id !== saved.conversation.id)]);
      setHistoryOpen(false);
      requestKeyRef.current=null;
    } catch (cause) {
      if (currentAccount.current !== accountId) return;
      if (answer) {
        setMessages(previous => [...previous,
          { id: crypto.randomUUID(), role: 'user', body: prompt, evidence: [], sequence_no: Date.now() },
          { id: crypto.randomUUID(), role: 'assistant', body: answer, evidence, sequence_no: Date.now() + 1 }]);
        setProposals(nextProposals);
        setError('The answer appeared, but it could not be saved. Copy anything you need before leaving this chat.');
      } else {
        if (sentFromComposer) setQuestion(current => current.trim() ? current : prompt);
        setError(cause instanceof Error ? cause.message : 'Could not answer that question.');
      }
    } finally { if (currentAccount.current === accountId) { setBusy(false); setPendingQuestion(''); } }
  };

  const actOnOrder = async (order:ChatOrderView,action:'revise'|'confirm'|'cancel'|'supplier_reply'|'review_reply'|'receive',payload:Record<string,unknown>,userText?:string) => {
    if (busy) return false;
    setBusy(true); setError('');
    try {
      const result=await chatOrderRequest<{order:ChatOrderView;answer:string}>(token,{accountId,action,orderId:order.id,version:order.version,...payload});
      if (currentAccount.current!==accountId) return false;
      setOrders(previous=>({...previous,[order.id]:result.order}));
      if (activeId) {
        if (userText) {
          const saved=await saveTurn(accountId,activeId,userText,result.answer,[]);
          setMessages(previous=>[...previous,...saved.messages]);
          setChats(previous=>[saved.conversation,...previous.filter(chat=>chat.id!==saved.conversation.id)]);
        } else {
          const saved=await saveActionResult(accountId,activeId,result.answer);
          setMessages(previous=>[...previous,saved]);
        }
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error?cause.message:'Could not update that order.');
      try {const refreshed=await chatOrderRequest<{order:ChatOrderView}>(token,{accountId,action:'get',orderId:order.id});setOrders(previous=>({...previous,[order.id]:refreshed.order}));} catch { /* keep the visible version */ }
      return false;
    } finally { if (currentAccount.current===accountId) setBusy(false); }
  };

  const addMissingItem = (order:ChatOrderView,lineIndex:number,rawText:string,draft:MissingItemContext['draft']) => {
    if (busy) return;
    setMissingItem({orderId:order.id,lineIndex,rawText,draft});
    const proposal:AssistantProposal={kind:'create_item',itemId:null,supplierId:null,productId:null,name:null,unit:null,baseQuantity:null,baseUnit:null,active:null,category:null,grade:null,aliases:[],date:null,quantity:null,price:null,usageKind:null,leadDays:null,claimId:null,claimStatus:null,deliveryLines:[],market:null,sourceName:null,sourceUrl:null,note:null};
    setProposals(previous=>[proposal,...previous]);
  };

  const confirmAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const proposal = proposals[0];
    if (!proposal || !ledger || busy) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true); setError('');
    let result = '';
    let createdItemId:string|undefined;
    try {
      const applied=await applyAssistantProposal(accountId, proposal, fields, ledger);
      result=typeof applied==='string'?applied:applied.message;
      createdItemId=typeof applied==='string'?undefined:applied.createdItemId;
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save that change.'); setBusy(false); return; }
    if (currentAccount.current !== accountId) return;
    try { await onLedgerChange(); }
    catch { setError(`${result} Reload the page to refresh your catalog.`); }
    if (proposal.kind === 'remember_fact') {
      try { setMemories(await listAgentMemories(accountId)); }
      catch { setError(`${result} Reload the page to refresh saved memories.`); }
    }
    if (createdItemId && missingItem) {
      const order=orders[missingItem.orderId];
      if (order?.status==='awaiting_review') {
        try {
          const lines=missingItem.draft.lines.map((line,index)=>index===missingItem.lineIndex?{...line,itemId:createdItemId,rawUnit:String(fields.get('unit') || ''),ambiguous:false}:line);
          const updated=await chatOrderRequest<{order:ChatOrderView}>(token,{accountId,action:'revise',orderId:order.id,version:order.version,lines,requestedDeliveryOn:missingItem.draft.requestedDeliveryOn,deliveryNote:missingItem.draft.deliveryNote});
          setOrders(previous=>({...previous,[order.id]:updated.order}));
          result+=' It is now in the order draft. Review its quantity and delivery date before confirming.';
        } catch (cause) {
          setError(`Item saved, but the order draft could not be updated: ${cause instanceof Error?cause.message:'open Edit details and select it.'}`);
        }
      }
      setMissingItem(null);
    }
    if (activeId) {
      try { const saved = await saveActionResult(accountId, activeId, result); setMessages(previous => [...previous, saved]); }
      catch {
        setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'assistant', body: result, evidence: [], sequence_no: Date.now() }]);
        setError(`${result} The confirmation could not be saved to chat history.`);
      }
    }
    setProposals(previous => previous.slice(1));
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
  const forgetMemory = async (memory: AgentMemory) => {
    if (busy || !window.confirm(`Forget “${memory.content}”?`)) return;
    try { await deleteAgentMemory(accountId, memory.id); setMemories(previous => previous.filter(row => row.id !== memory.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not forget that memory.'); }
  };
  const loadOlder = async () => {
    try {
      const result = await listConversations(accountId, chats.length);
      setChats(previous => [...previous, ...result.rows]); setHasMore(result.hasMore);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load older chats.'); }
  };

  const shown = chats.filter(chat => chat.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const active = chats.find(chat => chat.id === activeId);
  const latestOrderMessage = new Map<string,string>();
  for (const message of messages) {
    const id=chatOrderId(message.evidence);
    if (message.role==='assistant' && id) latestOrderMessage.set(id,message.id);
  }
  return <div className="ask-workspace ask-workspace-v2">
    <header className="ask-page-head"><div><p className="eyebrow">RESTOCK ASSISTANT</p><h2>Ask ReStock</h2><p>Ask about {accountName}'s records or tell the agents what to update.</p></div><button className="ask-new" onClick={newChat} disabled={busy}>＋ New chat</button></header>
    <div className="ask-mobile-history"><button onClick={() => setHistoryOpen(value => !value)} aria-expanded={historyOpen}>{historyOpen ? '← Back to chat' : `☰ Chats${chats.length ? ` (${chats.length})` : ''}`}</button><span>{active?.title || 'New conversation'}</span></div>
    {error && <div className="ask-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss message">×</button></div>}
    <div className={`ask-chat-layout ${historyOpen ? 'show-history' : ''}`}>
      <aside className="ask-history" aria-label="Conversation history"><div className="ask-history-heading"><strong>Conversations</strong><small>{chats.length} saved</small></div><label className="visually-hidden" htmlFor="ask-history-search">Search chats</label><input id="ask-history-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search chats" />
        <div className="ask-history-list">{loading ? <p className="muted">Loading chats…</p> : shown.length ? shown.map(chat => <div className={`ask-history-row ${chat.id === activeId ? 'active' : ''}`} key={chat.id}><button className="ask-history-open" onClick={() => void openChat(chat)} aria-current={chat.id === activeId ? 'page' : undefined}><span>{chat.title}</span><small>{shortDate(chat.updated_at)}</small></button><button className="ask-history-delete" title={`Delete ${chat.title}`} aria-label={`Delete ${chat.title}`} onClick={() => void removeChat(chat)}>×</button></div>) : <p className="muted">{search ? 'No matching chats.' : 'Your conversations will appear here after your first answer.'}</p>}</div>
        {hasMore && !search && <button className="ask-older" onClick={() => void loadOlder()}>Load older chats</button>}
        <details className="ask-memory"><summary>Outlet memory <span>{memories.length}</span></summary><p>Tell ReStock “remember that…” to add a fact for future chats.</p>{memories.length ? <ul>{memories.map(memory => <li key={memory.id}><span>{memory.content}</span><button type="button" onClick={() => void forgetMemory(memory)} aria-label={`Forget ${memory.content}`}>Forget</button></li>)}</ul> : <p>No saved memories yet.</p>}</details>
      </aside>
      <section className="ask-chat-main" aria-label="ReStock conversation"><div className="ask-thread-top"><div><span className="ai-spark small" aria-hidden="true"><AgentMark /></span><div><strong>ReStock assistant</strong><small>{accountName} · {active ? 'Saved conversation' : 'New conversation'}</small></div></div><div className="ask-thread-actions">{messages.length > 0 && <button type="button" className="ask-brief-shortcut" title="Generate morning brief" aria-label="Generate morning brief" disabled={busy} onClick={() => void ask('Generate my morning brief', 'brief')}>✦ <span>Morning brief</span></button>}</div></div>
        <div className="ask-thread-scroll" ref={scrollRef} aria-live="polite">{loading || loadingThread ? <p className="muted">Loading conversation…</p> : messages.length === 0 && !pendingQuestion ? <div className="ask-start"><span className="chat-mark" aria-hidden="true"><AgentMark /></span><h3>What would you like to do?</h3><p>Send a stock request in your own words. ReStock will split it by supplier and ask you to review it. You can also ask about prices, stock and your ledger.</p><div className="ask-start-suggestions">{suggestions.map(text => <button key={text} disabled={busy} onClick={() => void ask(text)}>{text}<span aria-hidden="true">↗</span></button>)}</div><button className="ask-brief-link" disabled={busy} onClick={() => void ask('Generate my morning brief', 'brief')}>✦ Generate morning brief</button></div> : <>{messages.map((entry,index) => {
          const orderId=chatOrderId(entry.evidence);
          const order=orderId ? orders[orderId] : undefined;
          return <div key={entry.id} ref={index===messages.length-1?lastMessageRef:undefined}><ChatTurn role={entry.role} body={entry.body} evidence={entry.evidence} />{entry.role==='assistant' && orderId && latestOrderMessage.get(orderId)===entry.id && order && <ChatOrderCard order={order} ledger={ledger} busy={busy} onAction={(action,payload,userText)=>actOnOrder(order,action,payload,userText)} onAddMissingItem={(lineIndex,rawText,draft)=>addMissingItem(order,lineIndex,rawText,draft)} />}</div>;
        })}{pendingQuestion && <><ChatTurn role="user" body={pendingQuestion} /><div className="chat-turn assistant chat-pending" role="status"><span className="chat-turn-avatar" aria-hidden="true"><AgentMark /></span><div className="chat-turn-body"><strong>ReStock assistant</strong><p>{waitingSeconds < 4 ? 'Planning the task…' : waitingSeconds < 20 ? 'Specialists are checking your records…' : 'Reviewing the findings…'}</p></div></div></>}</>}</div>
        <form className="ask-input" onSubmit={(event: FormEvent) => { event.preventDefault(); void ask(question); }}><label className="visually-hidden" htmlFor="ledger-question">Ask ReStock</label><textarea ref={composerRef} id="ledger-question" value={question} onChange={event => setQuestion(event.target.value)} placeholder="Message ReStock assistant…" minLength={2} maxLength={500} required rows={1} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><div><span>Enter to send · Shift+Enter for a new line</span><button type="submit" disabled={busy || question.trim().length < 2} aria-label="Send question">↑</button></div></form>
      </section>
    </div>
    {proposals[0] && ledger && <ActionReview key={`${proposals.length}-${proposals[0].kind}-${proposals[0].name || ''}`} proposal={proposals[0]} remaining={proposals.length} ledger={ledger} busy={busy} missingItemText={missingItem?.rawText} onConfirm={confirmAction} onCancel={() => {setProposals(previous => previous.slice(1));setMissingItem(null);}} />}
  </div>;
}


function AgentMark() { return <img src="/brand/restock-mark-reversed.svg" alt="" />; }

function ChatTurn({ role, body, evidence = [] }: { role: 'user' | 'assistant'; body: string; evidence?: string[] }) {
  const agentWork = evidence.filter(line => line.startsWith('Agent · '));
  const records = evidence.filter(line => !line.startsWith('Agent · ') && !line.startsWith('Chat order · '));
  return <div className={`chat-turn ${role}`}>
    {role === 'assistant' && <span className="chat-turn-avatar" aria-hidden="true"><AgentMark /></span>}
    <div className="chat-turn-body">
      {role === 'assistant' && <strong>ReStock assistant</strong>}
      <p>{body}</p>
      {role === 'assistant' && agentWork.length > 0 && <details className="chat-evidence chat-agent-work"><summary>{agentWork.length} specialist{agentWork.length === 1 ? '' : 's'} contributed</summary><ul>{agentWork.map((line, index) => <li key={index}>{line.slice(8)}</li>)}</ul></details>}
      {role === 'assistant' && records.length > 0 && <details className="chat-evidence"><summary>Supporting records</summary><ul>{records.map((line, index) => <li key={index}>{line}</li>)}</ul></details>}
    </div>
  </div>;
}

function ActionReview({ proposal, remaining, ledger, busy, missingItemText, onConfirm, onCancel }: { proposal: AssistantProposal; remaining: number; ledger: Ledger; busy: boolean; missingItemText?:string; onConfirm: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [supplierId, setSupplierId] = useState(proposal.supplierId || (proposal.kind === 'create_item' && !ledger.suppliers.length ? '__new' : ''));
  const [productId, setProductId] = useState(proposal.productId || (ledger.products.length ? '' : '__new'));
  const [lineSlots, setLineSlots] = useState<number[]>(Array.from({ length: Math.max(1, proposal.deliveryLines?.length || 0) }, (_, index) => index));
  const item = ledger.items.find(row => row.id === proposal.itemId);
  const titles = { create_item: 'Add supplier item', edit_item: 'Edit supplier item', toggle_item: proposal.active ? 'Reactivate item' : 'Deactivate item', create_product: 'Add product', create_supplier: 'Add supplier', record_quote: 'Record supplier quote', record_stock: 'Record stock count', record_usage: 'Record usage or waste', set_lead_time: 'Set delivery lead time', record_delivery: 'Record delivery', update_claim: 'Update shortage claim', record_benchmark: 'Record wholesale reference', remember_fact: 'Remember outlet fact' };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  return <dialog ref={dialogRef} className="ask-action-card" aria-labelledby="ask-action-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <div className="ask-action-heading"><span className="ai-spark small" aria-hidden="true"><AgentMark /></span><div><small>REVIEW BEFORE SAVING{remaining > 1 ? ` · ${remaining} CHANGES LEFT` : ''}</small><h3 id="ask-action-title">{titles[proposal.kind]}</h3></div><button type="button" className="ask-action-close" onClick={onCancel} disabled={busy} aria-label="Close review">×</button></div>
    <form onSubmit={onConfirm}>
      <div className="ask-action-fields"><p className="ask-action-intro">{missingItemText ? `Not found in your catalog: “${missingItemText}”. Add the exact supplier pack below. The order will still need your review.` : 'Complete the details below. Nothing changes in your ledger until you save.'}</p>
      {proposal.kind === 'create_supplier' && <label>Supplier name<input name="name" defaultValue={proposal.name || ''} minLength={2} maxLength={160} required /></label>}
      {proposal.kind === 'create_product' && <><label>Product name<input name="name" defaultValue={proposal.name || ''} minLength={2} maxLength={160} required /></label><label>Comparison unit<select name="baseUnit" defaultValue={proposal.baseUnit || ''} required><option value="">Choose a unit</option><option value="kg">kg</option><option value="l">litre</option><option value="each">each</option></select></label><label>Category<input name="category" defaultValue={proposal.category || ''} maxLength={80} /></label><label>Grade or specification<input name="grade" defaultValue={proposal.grade || ''} maxLength={80} /></label></>}
      {proposal.kind === 'record_quote' && <><label>Supplier item<select name="itemId" defaultValue={proposal.itemId || ''} required><option value="">Choose an item</option>{ledger.items.filter(row => row.active).map(row => <option key={row.id} value={row.id}>{row.name} · {ledger.suppliers.find(supplier => supplier.id === row.supplier_id)?.name}</option>)}</select></label><div className="ask-action-pair"><label>Quoted date<input name="date" type="date" defaultValue={proposal.date || today} required /></label><label>Price per pack (SGD)<input name="price" type="number" min="0.01" step="0.01" defaultValue={proposal.price ?? ''} required /></label></div></>}
      {proposal.kind === 'record_benchmark' && <><p className="ask-action-hint">Use a genuine comparable wholesale price. Check grade, pack conversion, location, and source before saving.</p><label>Comparable product<select name="productId" defaultValue={proposal.productId || ''} required><option value="">Choose a product</option>{ledger.products.map(row => <option key={row.id} value={row.id}>{row.name} · per {row.base_unit}</option>)}</select></label><div className="ask-action-pair"><label>Market<input name="market" defaultValue={proposal.market || 'Singapore'} minLength={2} maxLength={120} required /></label><label>Observed date<input name="date" type="date" defaultValue={proposal.date || today} required /></label></div><label>Price per product unit (SGD)<input name="price" type="number" min="0.001" step="0.001" defaultValue={proposal.price ?? ''} required /></label><label>Source name<input name="sourceName" defaultValue={proposal.sourceName || ''} minLength={2} maxLength={160} required /></label><label>Source URL<input name="sourceUrl" type="url" pattern="https://.*" defaultValue={proposal.sourceUrl || ''} maxLength={500} placeholder="https://…" /></label><label>Comparison notes<input name="note" defaultValue={proposal.note || ''} maxLength={400} placeholder="Grade, minimum quantity, terms" /></label></>}
      {proposal.kind === 'remember_fact' && <><p className="ask-action-hint">This fact will be available to the agent team in future chats. Check that it is accurate and suitable for this outlet.</p><label>What Ledger should remember<textarea name="note" defaultValue={proposal.note || ''} minLength={2} maxLength={500} rows={4} required /></label></>}
      {(proposal.kind === 'record_stock' || proposal.kind === 'record_usage') && <><label>Product<select name="productId" defaultValue={proposal.productId || ''} required><option value="">Choose a product</option>{ledger.products.map(row => <option key={row.id} value={row.id}>{row.name} · {row.base_unit}</option>)}</select></label><div className="ask-action-pair"><label>{proposal.kind === 'record_stock' ? 'Counted on' : 'Usage date'}<input name="date" type="date" defaultValue={proposal.date || today} required /></label><label>Quantity in product units<input name="quantity" type="number" min={proposal.kind === 'record_stock' ? '0' : '0.001'} step="0.001" defaultValue={proposal.quantity ?? ''} required /></label></div>{proposal.kind === 'record_usage' && <label>Type<select name="usageKind" defaultValue={proposal.usageKind || ''} required><option value="">Choose type</option><option value="used">Used or sold</option><option value="waste">Waste</option></select></label>}</>}
      {proposal.kind === 'set_lead_time' && <><label>Supplier<select name="supplierId" defaultValue={proposal.supplierId || ''} required><option value="">Choose a supplier</option>{ledger.suppliers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>Days from order to delivery<input name="leadDays" type="number" min="0" max="90" step="1" defaultValue={proposal.leadDays ?? ''} required /></label></>}
      {proposal.kind === 'update_claim' && <><label>Shortage claim<select name="claimId" defaultValue={proposal.claimId || ''} required><option value="">Choose a claim</option>{ledger.claims.map(row => <option key={row.id} value={row.id}>S${Number(row.amount).toFixed(2)} · {row.status} · {row.id.slice(0,8)}</option>)}</select></label><label>New status<select name="claimStatus" defaultValue={proposal.claimStatus || ''} required><option value="">Choose status</option><option value="open">Open</option><option value="asked">Asked supplier</option><option value="credited">Credited</option><option value="refused">Refused</option></select></label></>}
      {proposal.kind === 'record_delivery' && <><label>Supplier<select name="supplierId" value={supplierId} onChange={event => setSupplierId(event.target.value)} required><option value="">Choose a supplier</option>{ledger.suppliers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>Delivery date<input name="date" type="date" defaultValue={proposal.date || today} required /></label><p className="ask-action-hint">Confirm the ordered, delivered, and charged amounts separately. A shortage claim opens when charged exceeds delivered.</p>{lineSlots.map(index => { const line = proposal.deliveryLines?.[index]; return <div className="ask-delivery-line" key={index}><input type="hidden" name="lineIndex" value={index} /><div className="ask-delivery-line-head"><strong>Item {index + 1}</strong>{lineSlots.length > 1 && <button type="button" onClick={() => setLineSlots(previous => previous.filter(slot => slot !== index))}>Remove</button>}</div><label>Supplier item<select name={`lineItemId${index}`} defaultValue={line?.itemId || ''} required><option value="">Choose an item</option>{ledger.items.filter(row => row.supplier_id === supplierId && row.active).map(row => <option key={row.id} value={row.id}>{row.name} · {row.unit}</option>)}</select></label><div className="ask-delivery-numbers"><label>Ordered<input name={`lineOrdered${index}`} type="number" min="0" step="0.001" defaultValue={line?.quantityOrdered ?? ''} required /></label><label>Delivered<input name={`lineDelivered${index}`} type="number" min="0" step="0.001" defaultValue={line?.quantityDelivered ?? ''} required /></label><label>Charged<input name={`lineCharged${index}`} type="number" min="0" step="0.001" defaultValue={line?.quantityCharged ?? ''} required /></label><label>Price per pack<input name={`linePrice${index}`} type="number" min="0" step="0.01" defaultValue={line?.unitPrice ?? ''} required /></label></div></div>; })}<button type="button" className="ask-add-line" onClick={() => setLineSlots(previous => [...previous, Math.max(...previous) + 1])}>＋ Add item line</button></>}
      {(proposal.kind === 'create_item' || proposal.kind === 'edit_item') && <>
        <div className="ask-action-section"><span>01</span><div><strong>Source and comparison</strong><small>Choose who supplies it and how you compare its price.</small></div></div>
        {proposal.kind === 'create_item' ? <><label>Supplier<select name="supplierId" value={supplierId} onChange={event => setSupplierId(event.target.value)} required><option value="">Choose a supplier</option>{ledger.suppliers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}<option value="__new">＋ New supplier</option></select></label>{supplierId === '__new' && <label>New supplier name<input name="newSupplierName" minLength={2} maxLength={160} required placeholder="Supplier name" /></label>}</> : <div className="ask-action-fixed">Supplier <strong>{ledger.suppliers.find(row => row.id === item?.supplier_id)?.name || 'Unknown'}</strong></div>}
        <label>Comparable product<select name="productId" value={productId} onChange={event => setProductId(event.target.value)} required><option value="">Choose a product</option>{ledger.products.map(row => <option key={row.id} value={row.id}>{row.name} · {row.base_unit}</option>)}{proposal.kind === 'create_item' && <option value="__new">＋ New product</option>}</select></label>
        {productId === '__new' && proposal.kind === 'create_item' && <><label>New product name<input name="newProductName" defaultValue={proposal.name || ''} minLength={2} maxLength={160} required /></label><label>Compare new product per<select name="newBaseUnit" defaultValue={proposal.baseUnit || ''} required><option value="">Choose a unit</option><option value="kg">kg</option><option value="l">litre</option><option value="each">each</option></select></label></>}
        <div className="ask-action-section"><span>02</span><div><strong>Supplier pack</strong><small>Use the label and quantity shown by the supplier.</small></div></div>
        <label>Supplier item name<input name="name" defaultValue={proposal.name || ''} maxLength={160} required /></label><div className="ask-action-pair"><label>Pack unit<input name="unit" defaultValue={proposal.unit || ''} maxLength={30} required placeholder="carton, bottle, kg" /></label><label>Units in one pack<input name="baseQuantity" type="number" min="0.0001" max="1000000" step="0.0001" defaultValue={proposal.baseQuantity || ''} required placeholder="e.g. 24" /></label></div><label>Other names, comma separated<input name="aliases" defaultValue={proposal.aliases.join(', ')} /></label>
      </>}
      {proposal.kind === 'toggle_item' && <div className="ask-action-fixed">Item <strong>{item?.name || 'Unknown item'}</strong></div>}
      </div>
      <div className="ask-action-controls"><span>Only confirmed changes are saved</span><button type="button" onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" disabled={busy}>{busy ? 'Saving…' : `Save ${proposal.kind === 'toggle_item' ? 'change' : 'to ledger'}`}</button></div>
    </form>
  </dialog>;
}
