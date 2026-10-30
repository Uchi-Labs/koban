// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({status:vi.fn(),save:vi.fn(),fetch:vi.fn(),invalidate:vi.fn()}));
vi.mock('@/lib/shop-source',()=>({shopSessionStatus:mocks.status,saveShopSession:mocks.save,fetchShopSourceItems:mocks.fetch}));
vi.mock('@/lib/source-adapters',()=>({invalidateSourceAdapterProbes:mocks.invalidate}));
import {GET,POST} from '@/app/api/v1/sources/source_shop_orders/session/route';
beforeEach(()=>{vi.resetAllMocks();mocks.status.mockResolvedValue({configured:false,source:'none'});mocks.save.mockResolvedValue(undefined);});
describe('Shop session HTTP interface',()=>{
 it('does not claim live access from session presence',async()=>{mocks.status.mockResolvedValue({configured:true,source:'file'});const r=await GET(new Request('http://localhost/session'));expect(await r.json()).toMatchObject({configured:true,live_access:'not_checked'});expect(mocks.fetch).not.toHaveBeenCalled();});
 it('bounds a live status check to one page without exposing orders',async()=>{mocks.status.mockResolvedValue({configured:true});mocks.fetch.mockResolvedValue({items:[{title:'private purchase'}],hasMore:true});const r=await GET(new Request('http://localhost/session?verify=true'));const body=await r.json();expect(body).toMatchObject({live_access:'verified',items_seen:1,has_more:true});expect(JSON.stringify(body)).not.toContain('private purchase');expect(mocks.fetch).toHaveBeenCalledWith(expect.objectContaining({maxPages:1}));});
 it('saves a session without echoing credentials and rejects newlines',async()=>{const r=await POST(new Request('http://localhost/session',{method:'POST',body:JSON.stringify({cookie:'session=test-secret'})}));expect(r.status).toBe(200);expect(JSON.stringify(await r.json())).not.toContain('test-secret');expect(mocks.save).toHaveBeenCalledWith('session=test-secret');const invalid=await POST(new Request('http://localhost/session',{method:'POST',body:JSON.stringify({cookie:'session=x\nheader=y'})}));expect(invalid.status).toBe(400);expect(mocks.save).toHaveBeenCalledTimes(1);});
});
