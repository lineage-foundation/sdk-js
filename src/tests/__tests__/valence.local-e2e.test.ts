/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Standalone end-to-end validation of the DRUID 2-way (item<->item) payment flow
 * against a LOCAL Fleet stack (mempool /v1, storage /v1, valence relay).
 *
 * Unlike `valence.test.ts` (the reference test, which uses fixed sleeps tuned for
 * a remote/faster environment) this test polls balances/pending-payment state
 * instead of guessing wait times, since the local single-node mempool mines a
 * block roughly every ~30s.
 *
 * Gated: only runs when `RUN_LOCAL_E2E` is set, since it needs a real local
 * stack (mempool, storage, valence) running on the hosts below. It is skipped
 * by default so `npm test`/CI never needs network access.
 */
import axios from 'axios';
import { Wallet } from '../../services/wallet.service';
import { IKeypairEncrypted } from '../../interfaces';

const CONFIG = {
    mempoolHost: process.env.VALENCE_E2E_MEMPOOL_HOST ?? 'http://localhost:3003',
    storageHost: process.env.VALENCE_E2E_STORAGE_HOST ?? 'http://localhost:3001',
    valenceHost: process.env.VALENCE_E2E_VALENCE_HOST ?? 'http://localhost:3030',
    passphrase: 'test',
};

const describeLocalE2E = process.env.RUN_LOCAL_E2E ? describe : describe.skip;

// Debug: log the exact payload sent to /v1/transactions so we can inspect
// the embedded signable_data/signature on each TxIn.
axios.interceptors.request.use((config) => {
    if (config.url && config.url.includes('/v1/transactions')) {
        console.log(
            `[DEBUG] outgoing ${config.method} ${config.url}:`,
            JSON.stringify(config.data, null, 2),
        );
    }
    return config;
});

jest.setTimeout(5 * 60 * 1000); // generous ceiling given ~30s block time

const POLL_INTERVAL_MS = 3000;
const ITEM_POLL_TIMEOUT_MS = 90000;
const PENDING_POLL_TIMEOUT_MS = 90000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ts = () => new Date().toISOString();

async function waitForItemBalance(
    wallet: Wallet,
    address: string,
    genesisHash: string,
    minAmount = 1,
    timeoutMs = ITEM_POLL_TIMEOUT_MS,
): Promise<number> {
    const start = Date.now();
    let lastReason = '';
    while (Date.now() - start < timeoutMs) {
        const res = await wallet.fetchBalance([address]);
        if (res.status === 'success') {
            const items = res.content?.fetchBalanceResponse?.total.items ?? {};
            const amount = items[genesisHash] ?? 0;
            if (amount >= minAmount) return amount;
        } else {
            lastReason = res.reason ?? 'unknown error';
        }
        await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(
        `Timed out after ${timeoutMs}ms waiting for item ${genesisHash} (amount>=${minAmount}) ` +
            `at address ${address}. Last fetchBalance error (if any): ${lastReason}`,
    );
}

describeLocalE2E('valence local e2e', () => {
    test('DRUID 2-way item<->item payment settles end-to-end against local stack', async () => {
        const alice = new Wallet();
        const bob = new Wallet();

        // ---- Init wallets ----
        const aliceInit = await alice.initNew(CONFIG);
        expect(aliceInit.status).toBe('success');
        const aliceKp = alice.getNewKeypair([]).content?.newKeypairResponse as IKeypairEncrypted;
        expect(aliceKp).toBeDefined();

        const bobInit = await bob.initNew(CONFIG);
        expect(bobInit.status).toBe('success');
        const bobKp = bob.getNewKeypair([]).content?.newKeypairResponse as IKeypairEncrypted;
        expect(bobKp).toBeDefined();

        console.log('Alice address:', aliceKp.address);
        console.log('Bob address:', bobKp.address);

        // ---- Mint one item asset each (self-funded, no token top-up needed) ----
        const aliceItemRes = await alice.createItems(aliceKp, false, 1, null);
        expect(aliceItemRes.status).toBe('success');
        const aliceGenesis = aliceItemRes.content!.createItemResponse!.tx_hash;

        const bobItemRes = await bob.createItems(bobKp, false, 1, null);
        expect(bobItemRes.status).toBe('success');
        const bobGenesis = bobItemRes.content!.createItemResponse!.tx_hash;

        console.log('Alice item genesis_hash:', aliceGenesis);
        console.log('Bob item genesis_hash:', bobGenesis);

        // ---- Wait for both item-creation transactions to be mined & confirmed ----
        console.log('Waiting for item creation to confirm on-chain...');
        const aliceStartAmount = await waitForItemBalance(alice, aliceKp.address, aliceGenesis);
        const bobStartAmount = await waitForItemBalance(bob, bobKp.address, bobGenesis);
        console.log(
            `[${ts()}] Confirmed: Alice holds ${aliceStartAmount} of ${aliceGenesis}, Bob holds ${bobStartAmount} of ${bobGenesis}`,
        );

        // ---- Alice offers her item for Bob's item ----
        const sendItem = { Item: { amount: 1, genesis_hash: aliceGenesis, metadata: null } };
        const receiveItem = { Item: { amount: 1, genesis_hash: bobGenesis, metadata: null } };

        const make2W = await alice.make2WayPayment(
            bobKp.address,
            sendItem,
            receiveItem,
            [aliceKp],
            aliceKp,
        );
        console.log(`[${ts()}] make2WayPayment result:`, make2W);
        expect(make2W.status).toBe('success');
        const encryptedTx = make2W.content!.make2WayPaymentResponse!.encryptedTx;
        const druid = make2W.content!.make2WayPaymentResponse!.druid;
        expect(druid).toBeTruthy();

        // ---- Bob polls valence for the pending 2-way payment ----
        let entry: any = null;
        {
            const start = Date.now();
            while (!entry && Date.now() - start < PENDING_POLL_TIMEOUT_MS) {
                const fetchRes = await bob.fetchPending2WayPayment(bobKp);
                expect(fetchRes.status).toBe('success');
                const pending = fetchRes.content!.fetchPending2WResponse as any;
                entry = pending?.[druid];
                if (!entry) await sleep(POLL_INTERVAL_MS);
            }
        }
        console.log('Bob fetched pending 2WT entry:', entry);
        expect(entry).not.toBeNull();

        // ---- Bob accepts: submits his half to the mempool + flags accepted on valence ----
        console.log(`[${ts()}] Calling accept2WayPayment...`);
        const acceptRes = await bob.accept2WayPayment(entry.druid, entry, [bobKp]);
        console.log(`[${ts()}] accept2WayPayment result:`, acceptRes);
        expect(acceptRes.status).toBe('success');

        // ---- Alice re-polls valence; on seeing 'accepted' this submits her own half to the mempool ----
        let aliceFinal;
        {
            const start = Date.now();
            // Keep retrying in case Bob's 'accepted' status write to valence hasn't landed yet
            // eslint-disable-next-line no-constant-condition
            while (true) {
                aliceFinal = await alice.fetchPending2WayPayment(aliceKp, [encryptedTx]);
                if (
                    aliceFinal.status === 'success' ||
                    Date.now() - start > PENDING_POLL_TIMEOUT_MS
                ) {
                    break;
                }
                await sleep(POLL_INTERVAL_MS);
            }
        }
        console.log('Alice final fetchPending2WayPayment result:', aliceFinal);
        expect(aliceFinal.status).toBe('success');

        // ---- Wait for the swap transactions to be mined, then verify BOTH balances flipped ----
        console.log('Waiting for swap transactions to confirm on-chain...');
        const bobHasAliceItem = await waitForItemBalance(bob, bobKp.address, aliceGenesis);
        const aliceHasBobItem = await waitForItemBalance(alice, aliceKp.address, bobGenesis);

        console.log(
            `Post-swap: Bob holds ${bobHasAliceItem} of Alice's item (${aliceGenesis}), ` +
                `Alice holds ${aliceHasBobItem} of Bob's item (${bobGenesis})`,
        );

        expect(bobHasAliceItem).toBeGreaterThanOrEqual(1);
        expect(aliceHasBobItem).toBeGreaterThanOrEqual(1);

        // Cross-check directly against /v1/balances/query content for both addresses
        const aliceBalance = await alice.fetchBalance([aliceKp.address]);
        const bobBalance = await bob.fetchBalance([bobKp.address]);
        expect(
            aliceBalance.content?.fetchBalanceResponse?.total.items[bobGenesis],
        ).toBeGreaterThanOrEqual(1);
        expect(
            bobBalance.content?.fetchBalanceResponse?.total.items[aliceGenesis],
        ).toBeGreaterThanOrEqual(1);
    });
});
