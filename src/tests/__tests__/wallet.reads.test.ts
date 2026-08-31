import nock from 'nock';

import { Wallet } from '../../services/wallet.service';
import { ADDRESS_LIST_TEST } from '../constants';

const MEMPOOL_HOST = 'http://mempool.reads.test';
const STORAGE_HOST = 'http://storage.reads.test';

const [ADDRESS_ONE, ADDRESS_TWO] = Object.keys(ADDRESS_LIST_TEST);

// `initNetwork` still fetches the PoW route list on init (unchanged in this task); mock it
// so the reads under test can be exercised fully offline.
const mockDebugData = (host: string) =>
    nock(host)
        .persist()
        .get('/debug_data')
        .reply(200, {
            status: 'Success',
            content: {
                node_type: 'Storage',
                node_api: [],
                node_peers: [],
                routes_pow: {},
            },
        });

afterEach(() => {
    nock.cleanAll();
});

describe('fetchBalance', () => {
    test('sends POST {mempoolHost}/v1/balances/query and returns the balance content', async () => {
        mockDebugData(MEMPOOL_HOST);

        const balance = {
            total: { tokens: 60, items: {} },
            address_list: {
                [ADDRESS_ONE]: [],
                [ADDRESS_TWO]: [],
            },
        };
        const scope = nock(MEMPOOL_HOST)
            .post('/v1/balances/query', { addresses: [ADDRESS_ONE, ADDRESS_TWO] })
            .reply(200, { balance });

        const wallet = new Wallet();
        const init = await wallet.initNew({ mempoolHost: MEMPOOL_HOST, passphrase: 'test' });
        expect(init.status).toBe('success');

        const result = await wallet.fetchBalance([ADDRESS_ONE, ADDRESS_TWO]);

        expect(scope.isDone()).toBe(true);
        expect(result.status).toBe('success');
        expect(result.content?.fetchBalanceResponse).toEqual(balance);
    });

    test('sends the configured x-api-key header', async () => {
        mockDebugData(MEMPOOL_HOST);

        const balance = { total: { tokens: 0, items: {} }, address_list: {} };
        const scope = nock(MEMPOOL_HOST, { reqheaders: { 'x-api-key': 'my-api-key' } })
            .post('/v1/balances/query')
            .reply(200, { balance });

        const wallet = new Wallet();
        await wallet.initNew({
            mempoolHost: MEMPOOL_HOST,
            apiKey: 'my-api-key',
            passphrase: 'test',
        });

        const result = await wallet.fetchBalance([ADDRESS_ONE]);

        expect(scope.isDone()).toBe(true);
        expect(result.status).toBe('success');
    });

    test('maps an application/problem+json error response to an error result', async () => {
        mockDebugData(MEMPOOL_HOST);

        nock(MEMPOOL_HOST).post('/v1/balances/query').reply(
            500,
            {
                type: 'about:blank',
                title: 'Internal Server Error',
                status: 500,
                detail: 'the mempool node could not be reached',
            },
            { 'Content-Type': 'application/problem+json' },
        );

        const wallet = new Wallet();
        await wallet.initNew({ mempoolHost: MEMPOOL_HOST, passphrase: 'test' });

        const result = await wallet.fetchBalance([ADDRESS_ONE]);

        expect(result.status).toBe('error');
        expect(result.reason).toContain('the mempool node could not be reached');
    });
});

describe('fetchTransactions', () => {
    test('sends POST {storageHost}/v1/blockchain-entries/query and returns the entries content', async () => {
        mockDebugData(MEMPOOL_HOST);
        mockDebugData(STORAGE_HOST);

        const entries = [
            {
                key: '000000',
                item_meta: { type: 'tx', block_num: 0, tx_num: 0 },
                data: { inputs: [], outputs: [], version: 0, druid_info: null },
            },
        ];
        const scope = nock(STORAGE_HOST)
            .post('/v1/blockchain-entries/query', { keys: ['000000'] })
            .reply(200, entries);

        const wallet = new Wallet();
        const init = await wallet.initNew({
            mempoolHost: MEMPOOL_HOST,
            storageHost: STORAGE_HOST,
            passphrase: 'test',
        });
        expect(init.status).toBe('success');

        const result = await wallet.fetchTransactions(['000000']);

        expect(scope.isDone()).toBe(true);
        expect(result.status).toBe('success');
        expect(result.content?.fetchTransactionsResponse).toEqual(entries);
    });

    test('maps an application/problem+json error response to an error result', async () => {
        mockDebugData(MEMPOOL_HOST);
        mockDebugData(STORAGE_HOST);

        nock(STORAGE_HOST).post('/v1/blockchain-entries/query').reply(
            500,
            {
                type: 'about:blank',
                title: 'Internal Server Error',
                status: 500,
                detail: 'the storage node could not be reached',
            },
            { 'Content-Type': 'application/problem+json' },
        );

        const wallet = new Wallet();
        await wallet.initNew({
            mempoolHost: MEMPOOL_HOST,
            storageHost: STORAGE_HOST,
            passphrase: 'test',
        });

        const result = await wallet.fetchTransactions(['000000']);

        expect(result.status).toBe('error');
        expect(result.reason).toContain('the storage node could not be reached');
    });
});
