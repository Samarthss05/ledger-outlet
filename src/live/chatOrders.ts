export type ChatOrderLine = { itemId:string|null; quantity:number|null; rawUnit:string|null; rawText:string; ambiguous:boolean };
export type ChatOrderView = {
  id:string; account_id:string; raw_text:string; source_kind:'message'|'usual'|'repeat';
  requested_delivery_on:string|null; delivery_note:string; lines:ChatOrderLine[]; issues:string[];
  status:'awaiting_review'|'confirmed'|'cancelled'|'cancel_requested'|'received'; version:number;
  supplier_updates:Record<string,{text:string;suggestedStatus:'accepted'|'partial'|'rejected'|'unclear';status:'needs_review'|'accepted'|'partial'|'rejected';note:string;updatedAt:string}>;
  preview:{requestedDeliveryOn:string|null;deliveryNote:string;ready:boolean;issues:string[];groups:{supplierId:string;supplierName:string;lines:{itemId:string;itemName:string;quantity:number;unit:string}[]}[]};
  supplierMessages:{supplierId:string;supplierName:string;text:string}[];
};

export const chatOrderId = (evidence:string[]) => evidence.find(line=>line.startsWith('Chat order · '))?.slice('Chat order · '.length) || null;

export async function chatOrderRequest<T>(token:string,body:Record<string,unknown>):Promise<T> {
  const response=await fetch('/api/chat-orders',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
  const result=await response.json() as T & {error?:string};
  if (!response.ok) throw new Error(result.error || 'Could not update this order.');
  return result;
}
