import { useEffect, useRef, useState, type FormEvent } from 'react';

export type ChatEntry = { id: string; role: 'user' | 'assistant'; text: string; evidence?: string[] };
export type OrderDraft = { supplier: string; text: string; estimate: number; needsReview: boolean };
export type ParseResult = { text: string; evidence?: string[]; drafts?: OrderDraft[] };

const money = (value: number) => `S$${Number(value || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function AskWorkspace({ accountName, askText, setAskText, orderText, setOrderText, conversation, parseResult, busy, onAsk, onBrief, onParse, onClear }: {
  accountName: string; askText: string; setAskText: (value: string) => void; orderText: string; setOrderText: (value: string) => void;
  conversation: ChatEntry[]; parseResult: ParseResult | null; busy: boolean;
  onAsk: (question: string) => void; onBrief: () => void; onParse: () => void; onClear: () => void;
}) {
  const suggestions = ['What needs restocking?', 'Compare supplier prices', 'How much do suppliers owe me?'];
  const [mobileView, setMobileView] = useState<'chat' | 'tools'>('chat');
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (conversation.length) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [conversation.length]);
  const submit = (event: FormEvent) => { event.preventDefault(); if (askText.trim() && !busy) onAsk(askText.trim()); };
  return <div className="ask-workspace">
    <div className="ask-heading"><div><p className="eyebrow">YOUR PURCHASING ASSISTANT</p><h2>Ask your ledger</h2><p>Clear answers grounded in {accountName}'s records.</p></div>{conversation.length > 0 && <button className="new-chat" onClick={() => { onClear(); setMobileView('chat'); }}>＋ New conversation</button>}</div>
    <div className="ask-mobile-switch" role="group" aria-label="Assistant view"><button type="button" aria-pressed={mobileView === 'chat'} onClick={() => setMobileView('chat')}>Conversation</button><button type="button" aria-pressed={mobileView === 'tools'} onClick={() => setMobileView('tools')}>Tools & orders</button></div>
    <div className={`ask-columns mobile-${mobileView}`}><section className="conversation-panel" aria-label="Ledger conversation">
      <div className="conversation-scroll" ref={scrollRef} aria-live="polite">{conversation.length === 0 ? <div className="chat-welcome"><span className="chat-mark" aria-hidden="true">✦</span><h3>Where can I help today?</h3><p>Ask about spending, supplier prices, claims, and restocking. I’ll show the ledger facts behind each answer.</p><div className="suggestion-list">{suggestions.map(text => <button key={text} disabled={busy} onClick={() => onAsk(text)}>{text}<span aria-hidden="true">↗</span></button>)}</div></div> : conversation.map(entry => <div className={`chat-turn ${entry.role}`} key={entry.id}><span className="chat-turn-avatar" aria-hidden="true">{entry.role === 'assistant' ? '✦' : 'Y'}</span><div className="chat-turn-body"><strong>{entry.role === 'assistant' ? 'Ledger assistant' : 'You'}</strong><p>{entry.text}</p>{entry.role === 'assistant' && entry.evidence?.length ? <details className="chat-evidence"><summary>View ledger evidence</summary><ul>{entry.evidence.map((line, index) => <li key={index}>{line}</li>)}</ul></details> : null}</div></div>)}{busy && <div className="chat-pending" role="status"><span className="chat-turn-avatar">✦</span>Checking your ledger…</div>}</div>
      <div className="chat-composer"><form onSubmit={submit}><label className="visually-hidden" htmlFor="ledger-question">Ask your ledger</label><textarea id="ledger-question" value={askText} onChange={event => setAskText(event.target.value)} placeholder="Ask about your purchases, prices or stock…" minLength={2} maxLength={500} required rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}/><div className="composer-bottom"><span>Answers use your account data</span><button disabled={busy || askText.trim().length < 2} type="submit" aria-label="Send question">↑</button></div></form></div>
    </section><aside className="assistant-tools" aria-label="Assistant tools"><div className="tool-card"><span className="tool-icon lilac">✦</span><h3>Morning brief</h3><p>A concise summary of recorded spend, deliveries and open claims.</p><button disabled={busy} onClick={onBrief}>Generate brief <span aria-hidden="true">→</span></button></div>
      <div className="tool-card order-tool"><span className="tool-icon mint">▤</span><h3>Turn a message into an order</h3><p>Paste a stock request and review supplier drafts before using them.</p><form onSubmit={event => { event.preventDefault(); onParse(); }}><label className="visually-hidden" htmlFor="order-message">Order message</label><textarea id="order-message" value={orderText} onChange={event => setOrderText(event.target.value)} placeholder="10 kg tomatoes, 5 boxes lettuce…" minLength={3} maxLength={2000} required rows={4}/><button disabled={busy || orderText.trim().length < 3}>Prepare drafts <span aria-hidden="true">→</span></button></form>
        {parseResult && <div className="order-result"><strong>{parseResult.text}</strong>{parseResult.evidence?.map((line, index) => <p key={index}>{line}</p>)}{parseResult.drafts?.map((draft,index) => <div className="draft-result" key={index}><b>{draft.supplier} · est. {money(draft.estimate)}</b><pre>{draft.text}</pre><small>{draft.needsReview ? 'Needs review' : 'Review before sending'}</small><button type="button" onClick={() => navigator.clipboard.writeText(draft.text)}>Copy draft</button></div>)}</div>}
      </div></aside></div>
  </div>;
}
