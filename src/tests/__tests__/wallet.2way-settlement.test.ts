import nock from 'nock';

import { Wallet } from '../../services/wallet.service';
import { ADDRESS_LIST_TEST } from '../constants';
import { IPending2WTxDetails } from '../../interfaces';

const MEMPOOL_HOST = 'http://mempool.2way.test';
const VALENCE_HOST = 'http://valence.2way.test';

const [OTHER_PARTY_ADDRESS] = Object.keys(ADDRESS_LIST_TEST);

afterEach(() => {
    nock.cleanAll();
});

describe('accept2WayPayment', () => {
    test('sends POST {mempoolHost}/v1/transactions with `fees: null` and `druid_info.genesis_hash: null`', async () => {
        const wallet = new Wallet();
        const init = await wallet.initNew({
            mempoolHost: MEMPOOL_HOST,
            valenceHost: VALENCE_HOST,
            passphrase: 'test',
        });
        expect(init.status).toBe('success');

        const keypair = wallet.getNewKeypair([]).content?.newKeypairResponse;
        expect(keypair).toBeDefined();

        // `handle2WTxResponse` fetches the balance first, to gather inputs for the settlement tx
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
        const txScope = nock(MEMPOOL_HOST)
            .post('/v1/transactions', (body) => {
                requestBody = body;
                return true;
            })
            .reply(201, {
                transactions: {
                    settlement_tx_hash: {
                        address: OTHER_PARTY_ADDRESS,
                        asset: { kind: 'token', amount: 10 },
                    },
                },
            });

        // Valence stays legacy - the accepted settlement status still gets pushed there
        const valenceScope = nock(VALENCE_HOST).post('/set_data').reply(200, { status: 'Success' });

        const pendingResponse: IPending2WTxDetails = {
            druid: 'test_druid',
            senderExpectation: {
                from: '',
                to: OTHER_PARTY_ADDRESS, // What the other party expects to receive from us
                asset: { Token: 10 },
            },
            receiverExpectation: {
                from: '',
                to: keypair!.address, // What we expect to receive from the other party
                asset: { Token: 5 },
            },
            status: 'pending',
            mempoolHost: MEMPOOL_HOST,
        };

        const result = await wallet.accept2WayPayment('test_druid', pendingResponse, [keypair!]);

        expect(txScope.isDone()).toBe(true);
        expect(valenceScope.isDone()).toBe(true);

        expect(requestBody?.transactions).toHaveLength(1);
        const [sentTx] = requestBody!.transactions;
        expect(sentTx.fees).toBeNull();
        expect(sentTx.druid_info).toMatchObject({ druid: 'test_druid', genesis_hash: null });
        expect(sentTx.outputs).toBeDefined();

        expect(result.status).toBe('success');
    });
});
