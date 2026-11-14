// Client for the PinITHUB asset bridge (a mock server this week; see docs/openapi.yaml for the contract).
const base = () => process.env.ASSET_BRIDGE_URL ?? 'http://localhost:4100';
export interface BridgeAsset { id: string; name: string; owner: string; url: string; mime: string; width: number; height: number; bytes: number }

async function get(path: string, ownerId: string) {
  const r = await fetch(base() + path, { headers: { 'x-owner-id': ownerId }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`asset bridge ${r.status}`);
  return r.json();
}
export async function listAssets(ownerId: string): Promise<BridgeAsset[]> {
  return (await get('/assets', ownerId)) as BridgeAsset[];
}
export async function getProtectedCopy(assetId: string, ownerId: string): Promise<BridgeAsset> {
  const a = (await get(`/assets/${encodeURIComponent(assetId)}/protected-copy`, ownerId)) as BridgeAsset;
  if (a.owner !== ownerId) throw new Error('Asset not found'); // never expose another owner's asset
  return a;
}
