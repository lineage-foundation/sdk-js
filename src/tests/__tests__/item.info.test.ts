import nock from 'nock';
import { Wallet } from '../../services/wallet.service';
import { IFetchBalanceResponse } from '../../interfaces/network.interfaces';

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

// `fetchBalance` validates every address against a 64-char lowercase-hex pattern before it
// ever touches the network, so the brief's `addr1`/`addr2` placeholders can't be used verbatim
// here (they'd fail validation before enrichment is reached) - valid-looking hex addresses.
const ADDR1 = 'a1'.repeat(32);
const ADDR2 = 'b2'.repeat(32);

function balanceWith(genesisHash: string): IFetchBalanceResponse {
    return {
        total: { tokens: 0, items: { [genesisHash]: 5 } },
        address_list: {
            [ADDR1]: [
                {
                    out_point: { t_hash: 't0', n: 0 },
                    value: { Item: { amount: 5, genesis_hash: genesisHash, metadata: null } },
                },
            ],
        },
    } as unknown as IFetchBalanceResponse;
}

test('fetchBalance enriches item metadata by default', async () => {
    nock(MEMPOOL_HOST)
        .post('/v1/balances/query')
        .reply(200, { balance: balanceWith(GH) });
    const itemScope = nock(STORAGE_HOST).get(`/v1/items/${GH}`).reply(200, INFO);
    const wallet = await newWallet();
    const res = await wallet.fetchBalance([ADDR1]);
    expect(res.status).toBe('success');
    expect(itemScope.isDone()).toBe(true);
    const bal = res.content?.fetchBalanceResponse as IFetchBalanceResponse;
    const item = bal.address_list[ADDR1][0].value as { Item: { metadata: string | null } };
    expect(item.Item.metadata).toBe('ticket #1');
});

test('fetchBalance dedups + caches: two addrs, one genesis_hash -> one resolver call', async () => {
    const bal = balanceWith(GH);
    bal.address_list[ADDR2] = [
        {
            out_point: { t_hash: 't1', n: 0 },
            value: { Item: { amount: 3, genesis_hash: GH, metadata: null } },
        },
    ] as never;
    nock(MEMPOOL_HOST).post('/v1/balances/query').reply(200, { balance: bal });
    const itemScope = nock(STORAGE_HOST).get(`/v1/items/${GH}`).once().reply(200, INFO);
    const wallet = await newWallet();
    const res = await wallet.fetchBalance([ADDR1, ADDR2]);
    expect(itemScope.isDone()).toBe(true); // exactly one resolver call
    const b = res.content?.fetchBalanceResponse as IFetchBalanceResponse;
    expect(
        (b.address_list[ADDR2][0].value as { Item: { metadata: string | null } }).Item.metadata,
    ).toBe('ticket #1');
});

test('fetchBalance graceful degrade: resolver error -> metadata null, call succeeds', async () => {
    nock(MEMPOOL_HOST)
        .post('/v1/balances/query')
        .reply(200, { balance: balanceWith(GH) });
    nock(STORAGE_HOST).get(`/v1/items/${GH}`).reply(500, '');
    const wallet = await newWallet();
    const res = await wallet.fetchBalance([ADDR1]);
    expect(res.status).toBe('success');
    const b = res.content?.fetchBalanceResponse as IFetchBalanceResponse;
    expect(
        (b.address_list[ADDR1][0].value as { Item: { metadata: string | null } }).Item.metadata,
    ).toBeNull();
});

test('fetchBalance enrich=false issues no resolver calls', async () => {
    nock(MEMPOOL_HOST)
        .post('/v1/balances/query')
        .reply(200, { balance: balanceWith(GH) });
    // No storage interceptor: any resolver call throws.
    const wallet = await newWallet();
    const res = await wallet.fetchBalance([ADDR1], false);
    expect(res.status).toBe('success');
});
