import nock from 'nock';
import { Wallet } from '../../services/wallet.service';

const MEMPOOL_HOST = 'http://mempool.iteminfo.test';
const STORAGE_HOST = 'http://storage.iteminfo.test';
const GH = 'genesis0abc';
const INFO = {
    genesis_hash: GH,
    metadata: 'ticket #1',
    total_amount: 1000,
    created: { block_num: 42, tx_hash: GH },
    creator_address: 'addr_creator',
};

// `null` (not `undefined`) signals "no storage host": a `string | undefined = STORAGE_HOST`
// parameter would silently fall back to the default when called with an explicit
// `undefined` argument, defeating the "without storageHost" case below.
async function newWallet(storageHost: string | null = STORAGE_HOST) {
    const wallet = new Wallet();
    // Not `initOffline`: `initNetwork` (called internally when not offline) is what
    // actually assigns `this.storageHost` - it performs no network I/O itself, it just
    // validates and stores the config, so this stays fully offline/mocked via nock.
    await wallet.initNew({
        mempoolHost: MEMPOOL_HOST,
        storageHost: storageHost ?? undefined,
        passphrase: 'test',
    });
    return wallet;
}

afterEach(() => nock.cleanAll());

test('getItemInfo returns genesis facts on 200', async () => {
    const scope = nock(STORAGE_HOST).get(`/v1/items/${GH}`).reply(200, INFO);
    const wallet = await newWallet();
    const res = await wallet.getItemInfo(GH);
    expect(scope.isDone()).toBe(true);
    expect(res.status).toBe('success');
    expect(res.content?.getItemInfoResponse).toEqual(INFO);
});

test('getItemInfo caches: second call issues no HTTP', async () => {
    nock(STORAGE_HOST).get(`/v1/items/${GH}`).once().reply(200, INFO);
    const wallet = await newWallet();
    const first = await wallet.getItemInfo(GH);
    expect(first.status).toBe('success');
    // No nock interceptor remains; a second HTTP call would throw.
    const second = await wallet.getItemInfo(GH);
    expect(second.status).toBe('success');
    expect(second.content?.getItemInfoResponse).toEqual(INFO);
});

test('getItemInfo 404 -> error and is NOT cached (retryable)', async () => {
    nock(STORAGE_HOST).get(`/v1/items/${GH}`).reply(404, '');
    const wallet = await newWallet();
    const miss = await wallet.getItemInfo(GH);
    expect(miss.status).toBe('error');
    // A later success must still hit the network (failure not cached).
    const scope = nock(STORAGE_HOST).get(`/v1/items/${GH}`).reply(200, INFO);
    const hit = await wallet.getItemInfo(GH);
    expect(scope.isDone()).toBe(true);
    expect(hit.status).toBe('success');
});

test('getItemInfo without storageHost -> StorageNotInitialized error', async () => {
    const wallet = await newWallet(null);
    const res = await wallet.getItemInfo(GH);
    expect(res.status).toBe('error');
    expect(res.reason).toContain('Storage');
});
