import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatOrderCard } from '../src/live/ChatOrderCard';
import type { ChatOrderView } from '../src/live/chatOrders';

const draft:ChatOrderView={
  id:'11111111-1111-4111-8111-111111111111',account_id:'22222222-2222-4222-8222-222222222222',raw_text:'coke 2 cartons',source_kind:'message',
  requested_delivery_on:null,delivery_note:'',lines:[{itemId:null,quantity:2,rawUnit:'carton',rawText:'coke 2 cartons',ambiguous:true}],issues:[],
  status:'awaiting_review',version:1,supplier_updates:{},preview:{requestedDeliveryOn:null,deliveryNote:'',ready:false,issues:['Review item “coke 2 cartons”.'],groups:[]},supplierMessages:[]
};

test('an unmatched order line offers catalog creation before confirmation',()=>{
  const html=renderToStaticMarkup(createElement(ChatOrderCard,{order:draft,ledger:null,busy:false,onAction:async()=>true,onAddMissingItem:()=>{}}));
  assert.match(html,/Not in this outlet’s catalog/);
  assert.match(html,/coke 2 cartons/);
  assert.match(html,/Add item/);
  assert.match(html,/Confirm order/);
  assert.match(html,/disabled=""/);
});
