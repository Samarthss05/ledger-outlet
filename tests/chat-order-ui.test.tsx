import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatOrderCard } from '../src/live/ChatOrderCard';
import type { ChatOrderView } from '../src/live/chatOrders';
import type { Ledger } from '../src/live/types';

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

test('a recognized item with missing quantity stays visible in the review card',()=>{
  const itemId='33333333-3333-4333-8333-333333333333';
  const supplierId='44444444-4444-4444-8444-444444444444';
  const order={...draft,raw_text:'order kangkong',lines:[{itemId,quantity:null,rawUnit:null,rawText:'order kangkong',ambiguous:true}]};
  const ledger={items:[{id:itemId,supplier_id:supplierId,name:'Kangkong',unit:'kg',active:true}],suppliers:[{id:supplierId,name:'Vegetable Supplier'}]} as Ledger;
  const html=renderToStaticMarkup(createElement(ChatOrderCard,{order,ledger,busy:false,onAction:async()=>true,onAddMissingItem:()=>{}}));
  assert.match(html,/Recognized from your catalog/);
  assert.match(html,/Kangkong/);
  assert.match(html,/How many kg\?/);
  assert.doesNotMatch(html,/Not in this outlet’s catalog/);
});
