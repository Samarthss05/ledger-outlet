import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUsualLines } from '../server/chatOrders.js';
import { validateOutletOrder, type OrderItem, type OrderSupplier } from '../server/whatsappOrder.js';

const supplier:OrderSupplier={id:'supplier',name:'Main Supplier',whatsapp_e164:null,delivery_days:[2],cutoff_time:null,lead_time_days:1};
const item:OrderItem={id:'item',supplier_id:'supplier',product_id:'product',base_quantity:24,name:'Coke carton of 24',unit:'carton',aliases:['Coke'],order_unit_aliases:[],active:true};
const now=new Date('2026-10-12T03:00:00Z'); // Monday 11am Singapore

test('usual order uses fresh computed need converted into whole supplier packs',()=>{
  const lines=buildUsualLines([{product_id:'product',suggested_quantity:50,usage_days:7,counted_on:'2026-10-12'}],[item]);
  assert.equal(lines.length,1);
  assert.equal(lines[0].quantity,3);
  const preview=validateOutletOrder({requestedDeliveryOn:'2026-10-13',deliveryNote:'',lines,unmatched:[]},[item],[supplier],now,undefined,{channel:'chat'});
  assert.equal(preview.ready,true);
  assert.equal(preview.groups[0].lines[0].quantity,3);
});

test('usual order refuses stale estimates and ambiguous supplier mappings',()=>{
  assert.deepEqual(buildUsualLines([{product_id:'product',suggested_quantity:null,usage_days:7,counted_on:'2026-10-12'}],[item]),[]);
  assert.deepEqual(buildUsualLines([{product_id:'product',suggested_quantity:50,usage_days:3,counted_on:'2026-10-12'}],[item]),[]);
  assert.deepEqual(buildUsualLines([{product_id:'product',suggested_quantity:50,usage_days:7,counted_on:'2026-10-12'}],[item,{...item,id:'rival',supplier_id:'other'}]),[]);
});
