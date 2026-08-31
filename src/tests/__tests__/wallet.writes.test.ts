import nock from 'nock';

import { Wallet } from '../../services/wallet.service';
import { ADDRESS_LIST_TEST } from '../constants';
import { NETWORK_VERSION } from '../../mgmt/constants';

const MEMPOOL_HOST = 'http://mempool.writes.test';

const [PAYMENT_ADDRESS] = Object.keys(ADDRESS_LIST_TEST);

afterEach(() => {
    nock.cleanAll();
});

describe('createItems', () => {
    test('sends POST {mempoolHost}/v1/items without a `version` field and maps the response', async () => {
        const wallet = new Wallet();
        const init = await wallet.initNew({ mempoolHost: MEMPOOL_HOST, passphrase: 'test' });
        expect(init.status).toBe('success');

        const keypair = wallet.getNewKeypair([]).content?.newKeypairResponse;
        expect(keypair).toBeDefined();

        let requestBody: Record<string, unknown> | undefined;
        const scope = nock(MEMPOOL_HOST)
            .post('/v1/items', (body) => {
                requestBody = body;
                return true;
            })
            .reply(201, {
                asset: { kind: 'item', amount: 3, genesis_hash: null, metadata: null },
                to_address: keypair!.address,
                tx_hash: 'item_tx_hash',
            });

        const result = await wallet.createItems(keypair!, true, 3);

        expect(scope.isDone()).toBe(true);
        expect(requestBody).not.toHaveProperty('version');
        expect(Object.keys(requestBody!).sort()).toEqual(
            [
                'genesis_hash_spec',
                'item_amount',
                'metadata',
                'public_key',
                'script_public_key',
                'signature',
            ].sort(),
        );

        expect(result.status).toBe('success');
        expect(result.content?.createItemResponse).toEqual({
            asset: { kind: 'item', amount: 3, genesis_hash: null, metadata: null },
            to_address: keypair!.address,
            tx_hash: 'item_tx_hash',
        });
    });

    test('maps an application/problem+json error response to an error result', async () => {
        const wallet = new Wallet();
        await wallet.initNew({ mempoolHost: MEMPOOL_HOST, passphrase: 'test' });
        const keypair = wallet.getNewKeypair([]).content?.newKeypairResponse;

        nock(MEMPOOL_HOST).post('/v1/items').reply(
            400,
            {
                type: 'about:blank',
                title: 'Bad Request',
                status: 400,
                detail: 'script_public_key, public_key and signature are required',
            },
            { 'Content-Type': 'application/problem+json' },
        );

        const result = await wallet.createItems(keypair!, true, 3);

        expect(result.status).toBe('error');
        expect(result.reason).toContain('script_public_key, public_key and signature are required');
    });
});

describe('makeTokenPayment', () => {
    test('sends POST {mempoolHost}/v1/transactions with `fees: null` and maps the response', async () => {
        const wallet = new Wallet();
        const init = await wallet.initNew({ mempoolHost: MEMPOOL_HOST, passphrase: 'test' });
        expect(init.status).toBe('success');

        const keypair = wallet.getNewKeypair([]).content?.newKeypairResponse;
        const excessKeypair = wallet.getNewKeypair([keypair!.address]).content?.newKeypairResponse;
        expect(keypair).toBeDefined();
        expect(excessKeypair).toBeDefined();

        // `makePayment` fetches the balance first
        nock(MEMPOOL_HOST)
            .post('/v1/balances/query', { addresses: [keypair!.address] })
            .reply(200, {
                balance: {
                    total: { tokens: 100, items: {} },
                    address_list: {
                        [keypair!.address]: [
                            { out_point: { t_hash: '000000', n: 0 }, value: { Token: 100 } },
                        ],
                    },
                },
            });

        let requestBody: { transactions: Record<string, unknown>[] } | undefined;
        const scope = nock(MEMPOOL_HOST)
            .post('/v1/transactions', (body) => {
                requestBody = body;
                return true;
            })
            .reply(201, {
                transactions: {
                    payment_tx_hash: {
                        address: PAYMENT_ADDRESS,
                        asset: { kind: 'token', amount: 50 },
                    },
                },
            });

        const result = await wallet.makeTokenPayment(
            PAYMENT_ADDRESS,
            50,
            [keypair!],
            excessKeypair!,
        );

        expect(scope.isDone()).toBe(true);
        expect(requestBody?.transactions).toHaveLength(1);
        const [sentTx] = requestBody!.transactions;
        expect(sentTx.fees).toBeNull();
        expect(sentTx.version).toBe(NETWORK_VERSION);
        expect(sentTx.druid_info).toBeNull();
        expect(sentTx.inputs).toBeDefined();
        expect(sentTx.outputs).toBeDefined();

        expect(result.status).toBe('success');
        expect(result.content?.makePaymentResponse).toEqual({
            transactionHash: 'payment_tx_hash',
            paymentAddress: PAYMENT_ADDRESS,
            asset: { kind: 'token', amount: 50 },
            usedAddresses: [keypair!.address],
        });
    });

    test('maps an application/problem+json error response to an error result', async () => {
        const wallet = new Wallet();
        await wallet.initNew({ mempoolHost: MEMPOOL_HOST, passphrase: 'test' });

        const keypair = wallet.getNewKeypair([]).content?.newKeypairResponse;
        const excessKeypair = wallet.getNewKeypair([keypair!.address]).content?.newKeypairResponse;

        nock(MEMPOOL_HOST)
            .post('/v1/balances/query', { addresses: [keypair!.address] })
            .reply(200, {
                balance: {
                    total: { tokens: 100, items: {} },
                    address_list: {
                        [keypair!.address]: [
                            { out_point: { t_hash: '000000', n: 0 }, value: { Token: 100 } },
                        ],
                    },
                },
            });

        nock(MEMPOOL_HOST).post('/v1/transactions').reply(
            400,
            {
                type: 'about:blank',
                title: 'Bad Request',
                status: 400,
                detail: 'one or more transactions were malformed',
            },
            { 'Content-Type': 'application/problem+json' },
        );

        const result = await wallet.makeTokenPayment(
            PAYMENT_ADDRESS,
            50,
            [keypair!],
            excessKeypair!,
        );

        expect(result.status).toBe('error');
        expect(result.reason).toContain('one or more transactions were malformed');
    });
});
