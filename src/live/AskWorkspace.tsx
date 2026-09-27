import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createConversation, deleteConversation, listConversations, loadConversation, saveTurn, type Conversation, type ConversationMessage } from './conversations';

const suggestions = ['What needs restocking?', 'Compare supplier prices', 'How much do suppliers owe me?'];
const shortDate = (value: string) => new Date(value).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });

export function AskWorkspace({ accountId, accountName, token }: { accountId: string; accountName: string; token: string }) {
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
  const requestId = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentAccount = useRef(accountId);
  currentAccount.current = accountId;

  useEffect(() => {
    const current = ++requestId.current;
    setChats([]); setActiveId(null); setMessages([]); setQuestion(''); setError(''); setLoading(true); setBusy(false); setPendingQuestion(''); setHistoryOpen(false);
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

  const newChat = () => { requestId.current++; setActiveId(null); setMessages([]); setQuestion(''); setError(''); setHistoryOpen(false); setLoading(false); setLoadingThread(false); };
  const openChat = async (chat: Conversation) => {
    if (busy || chat.id === activeId) { setHistoryOpen(false); return; }
    const current = ++requestId.current;
    setLoadingThread(true); setError(''); setHistoryOpen(false);
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
    let answer = ''; let evidence: string[] = []; let nextId = activeId;
    try {
      const response = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, accountId, ...(action === 'ask' ? { question: prompt, ...(activeId ? { conversationId: activeId } : {}) } : {}) }) });
      const result = await response.json() as { answer?: string; brief?: string; evidence?: string[]; error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not answer that question.');
      if (currentAccount.current !== accountId) return;
      answer = result.answer || result.brief || '';
      if (!answer) throw new Error('The assistant returned an empty answer. Please try again.');
      evidence = Array.isArray(result.evidence) ? result.evidence : [];
      if (!nextId) {
        const created = await createConversation(accountId, prompt.replace(/\s+/g, ' ').slice(0, 80));
        nextId = created.id; setActiveId(created.id); setChats(previous => [created, ...previous]);
      }
      const saved = await saveTurn(accountId, nextId, prompt, answer, evidence);
      if (currentAccount.current !== accountId) return;
      setMessages(previous => [...previous, ...saved.messages]);
      setChats(previous => [saved.conversation, ...previous.filter(chat => chat.id !== saved.conversation.id)]);
      setQuestion(''); setHistoryOpen(false);
    } catch (cause) {
      if (currentAccount.current !== accountId) return;
      if (answer) {
        setMessages(previous => [...previous,
          { id: crypto.randomUUID(), role: 'user', body: prompt, evidence: [], sequence_no: Date.now() },
          { id: crypto.randomUUID(), role: 'assistant', body: answer, evidence, sequence_no: Date.now() + 1 }]);
        setError('The answer appeared, but it could not be saved. Copy anything you need before leaving this chat.');
      } else setError(cause instanceof Error ? cause.message : 'Could not answer that question.');
    } finally { if (currentAccount.current === accountId) { setBusy(false); setPendingQuestion(''); } }
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
    <header className="ask-page-head"><div><p className="eyebrow">LEDGER ASSISTANT</p><h2>Ask your ledger</h2><p>Answers from {accountName}'s recorded purchases, prices, stock, and claims.</p></div><button className="ask-new" onClick={newChat} disabled={busy}>＋ New chat</button></header>
    <div className="ask-mobile-history"><button onClick={() => setHistoryOpen(value => !value)} aria-expanded={historyOpen}>{historyOpen ? '← Back to chat' : `☰ Chats${chats.length ? ` (${chats.length})` : ''}`}</button><span>{active?.title || 'New conversation'}</span></div>
    {error && <div className="ask-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss message">×</button></div>}
    <div className={`ask-chat-layout ${historyOpen ? 'show-history' : ''}`}>
      <aside className="ask-history" aria-label="Conversation history"><div className="ask-history-heading"><strong>Conversations</strong><small>{chats.length} saved</small></div><label className="visually-hidden" htmlFor="ask-history-search">Search chats</label><input id="ask-history-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search chats" />
        <div className="ask-history-list">{loading ? <p className="muted">Loading chats…</p> : shown.length ? shown.map(chat => <div className={`ask-history-row ${chat.id === activeId ? 'active' : ''}`} key={chat.id}><button className="ask-history-open" onClick={() => void openChat(chat)} aria-current={chat.id === activeId ? 'page' : undefined}><span>{chat.title}</span><small>{shortDate(chat.updated_at)}</small></button><button className="ask-history-delete" title={`Delete ${chat.title}`} aria-label={`Delete ${chat.title}`} onClick={() => void removeChat(chat)}>×</button></div>) : <p className="muted">{search ? 'No matching chats.' : 'Your conversations will appear here after your first answer.'}</p>}</div>
        {hasMore && !search && <button className="ask-older" onClick={() => void loadOlder()}>Load older chats</button>}
      </aside>
      <section className="ask-chat-main" aria-label="Ledger conversation"><div className="ask-thread-top"><div><span className="ai-spark small" aria-hidden="true">✦</span><div><strong>{active?.title || 'New conversation'}</strong><small>Ledger records · {accountName}</small></div></div><div className="ask-thread-actions">{active && <span className="ask-saved">Saved</span>}{messages.length > 0 && <button type="button" className="ask-brief-shortcut" title="Generate morning brief" aria-label="Generate morning brief" disabled={busy} onClick={() => void ask('Generate my morning brief', 'brief')}>✦ <span>Morning brief</span></button>}</div></div>
        <div className="ask-thread-scroll" ref={scrollRef} aria-live="polite">{loading || loadingThread ? <p className="muted">Loading conversation…</p> : messages.length === 0 && !pendingQuestion ? <div className="ask-start"><span className="chat-mark" aria-hidden="true">✦</span><h3>What would you like to know?</h3><p>Ask one question about your outlet. I’ll use your records and show the supporting facts when available.</p><div className="ask-start-suggestions">{suggestions.map(text => <button key={text} disabled={busy} onClick={() => void ask(text)}>{text}<span aria-hidden="true">↗</span></button>)}</div><button className="ask-brief-link" disabled={busy} onClick={() => void ask('Generate my morning brief', 'brief')}>✦ Generate morning brief</button></div> : <>{messages.map(entry => <div className={`chat-turn ${entry.role}`} key={entry.id}><span className="chat-turn-avatar" aria-hidden="true">{entry.role === 'assistant' ? '✦' : 'Y'}</span><div className="chat-turn-body"><strong>{entry.role === 'assistant' ? 'Ledger assistant' : 'You'}</strong><p>{entry.body}</p>{entry.role === 'assistant' && entry.evidence?.length ? <details className="chat-evidence"><summary>Supporting records</summary><ul>{entry.evidence.map((line, index) => <li key={index}>{line}</li>)}</ul></details> : null}</div></div>)}{pendingQuestion && <><div className="chat-turn user"><span className="chat-turn-avatar" aria-hidden="true">Y</span><div className="chat-turn-body"><strong>You</strong><p>{pendingQuestion}</p></div></div><div className="chat-pending" role="status"><span className="chat-turn-avatar">✦</span>Checking your ledger…</div></>}</>}</div>
        <form className="ask-input" onSubmit={(event: FormEvent) => { event.preventDefault(); void ask(question); }}><label className="visually-hidden" htmlFor="ledger-question">Ask your ledger</label><textarea id="ledger-question" value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask about a supplier, price, claim, or stock…" minLength={2} maxLength={500} required rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><div><span>Answers use this outlet’s records</span><button type="submit" disabled={busy || question.trim().length < 2} aria-label="Send question">↑</button></div></form>
      </section>
    </div>
  </div>;
}
