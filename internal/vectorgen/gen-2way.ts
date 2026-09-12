// Golden-vector generator for shared 2-way-payment fixtures (`twoway.json`), consumed by
// every Lineage SDK (sdk-go, sdk-php, sdk-laravel, sdk-rust, sdk-python) so their own
// 2-way-payment construction can be tested byte-for-byte against sdk-js — the canonical
// reference implementation.
//
// This script is run directly from an sdk-js checkout (it imports internal, unexported
// crypto primitives from `src/`) and is NOT part of sdk-js's own build or test suite.
// See README.md in this directory for exact run instructions.
//
// Every value below is derived from FIXED inputs (a fixed DRUID string, fixed balance,
// fixed keypairs, fixed expectations, fixed excess address) so re-running this script
// against the same sdk-js commit reproduces byte-identical JSON. Nothing here
// re-implements sdk-js crypto or tx-construction logic; it only calls the real
// `create2WTxHalf` / `constructTxInsAddress` / `generateVerificationHeaders` functions and
// dumps their outputs.

import * as fs from 'fs';
import nacl from 'tweetnacl';

import { generateKeypair } from '../../src/mgmt/key.mgmt';
import { create2WTxHalf } from '../../src/mgmt/item.mgmt';
import { constructTxInsAddress } from '../../src/mgmt/script.mgmt';
import { DEFAULT_GENESIS_HASH_SPEC } from '../../src/mgmt/constants';
import { generateVerificationHeaders } from '../../src/utils/valence.utils';
import { initIDruidExpectation, initIPending2WTxDetails } from '../../src/utils/interface.utils';
import {
    getStringBytes,
    getBytesHexString,
    getHexStringBytes,
} from '../../src/utils/general.utils';
import { ADDRESS_LIST_TEST, FETCH_BALANCE_RESPONSE_TEST } from '../../src/tests/constants';
import { IKeypair, ICreateTxIn } from '../../src/interfaces';

const hex = (u: Uint8Array): string => Buffer.from(u).toString('hex');

function unwrap<T>(r: { isErr(): boolean; isOk(): boolean; value?: T; error?: unknown }): T {
    if (r.isErr()) throw new Error(`unwrap failed: ${JSON.stringify(r.error)}`);
    return r.value as T;
}

// Fixed, injected DRUID — NOT randomly generated, so downstream SDK tests are deterministic.
const DRUID = 'DRUID0xf1d2d2f924e986ac86fdf7b36c94bcdf';

/* -------------------------------------------------------------------------- */
/* (a) create2WTxHalf — mirrors src/tests/__tests__/item.mgmt.test.ts:89-210  */
/* -------------------------------------------------------------------------- */

const keyPairMap = new Map<string, IKeypair>();
for (const addr of Object.keys(ADDRESS_LIST_TEST)) {
    keyPairMap.set(addr, {
        address: addr,
        secretKey: Buffer.from(ADDRESS_LIST_TEST[addr].secret_key, 'hex'),
        publicKey: Buffer.from(ADDRESS_LIST_TEST[addr].public_key, 'hex'),
        version: ADDRESS_LIST_TEST[addr].address_version,
    });
}

// NOTE ON DEVIATING FROM item.mgmt.test.ts:89-210's literal `to`/`excessAddress` strings:
// that golden test passes non-hex placeholders ('our_receive_address', 'excess_address',
// 'their_receive_address') into fields that `createTx()` runs through `validateAddress()`
// (`^[a-f0-9]{64}$`). `create2WTxHalf` therefore actually returns Err(InvalidInputs) for
// those inputs — the test's assertions live inside `if (createTransaction.isOk())` and so
// never execute; it passes vacuously. Verified by reproducing the exact same call in an
// isolated debug test: `isOk()` is false. Reusing those literal strings here would silently
// bake a non-existent ("never actually produced") result into the shared golden vectors, so
// this generator keeps the same fixed balance/keypairs/asset amounts but substitutes real
// 64-hex-char addresses (two of our own already-fixed test addresses, plus one fixed
// deterministically-derived "counterparty" keypair) for every address-shaped field so
// `create2WTxHalf` actually succeeds.
const counterparty = unwrap(generateKeypair(null, getHexStringBytes('11'.repeat(32))));
const ourAddress = Object.keys(ADDRESS_LIST_TEST)[0]; // cf0067...05b7c — owns 2 of the 3 gathered inputs
const theirAddress = counterparty.address;

// senderExpectation: what the *other* party (counterparty) is expected to send us (an Item).
const senderExpectation = initIDruidExpectation({
    asset: {
        Item: {
            amount: 1,
            genesis_hash: DEFAULT_GENESIS_HASH_SPEC,
            metadata: "{'test': 'test'}",
        },
    },
    from: theirAddress,
    to: ourAddress,
});

// receiverExpectation: what we (the sender of this tx half) are paying out (Tokens).
const receiverExpectation = initIDruidExpectation({
    asset: {
        Token: 1050,
    },
    from: ourAddress,
    to: theirAddress,
});

const excessAddress = ourAddress;

const createTransaction = unwrap(
    create2WTxHalf(
        FETCH_BALANCE_RESPONSE_TEST,
        DRUID,
        senderExpectation,
        receiverExpectation,
        excessAddress,
        keyPairMap,
        0,
    ),
);

const { createTx, usedAddresses } = createTransaction;

const inputs = createTx.inputs.map((txIn) => ({
    previous_out: txIn.previous_out,
    script_signature: txIn.script_signature,
}));

/* -------------------------------------------------------------------------- */
/* (b) constructTxInsAddress — driven with the fixed inputs produced above    */
/* -------------------------------------------------------------------------- */

const txInsAddress = unwrap(constructTxInsAddress(createTx.inputs as ICreateTxIn[]));

/* -------------------------------------------------------------------------- */
/* (c) valence auth vector — generateVerificationHeaders() for a fixed        */
/*     address + secret key (real sdk-js code: nacl.sign.detached under the   */
/*     hood via createSignature)                                              */
/* -------------------------------------------------------------------------- */

const valenceAddress = Object.keys(ADDRESS_LIST_TEST)[0];
const valenceKeyPair: IKeypair = {
    address: valenceAddress,
    secretKey: Buffer.from(ADDRESS_LIST_TEST[valenceAddress].secret_key, 'hex'),
    publicKey: Buffer.from(ADDRESS_LIST_TEST[valenceAddress].public_key, 'hex'),
    version: ADDRESS_LIST_TEST[valenceAddress].address_version,
};

const verificationHeaders = generateVerificationHeaders(valenceAddress, valenceKeyPair);

// Cross-check against a from-scratch nacl.sign.detached call over utf8(address), as specified
// in the task brief, to prove generateVerificationHeaders() does exactly this and nothing more.
const directSignature = hex(
    nacl.sign.detached(getStringBytes(valenceAddress), valenceKeyPair.secretKey),
);
if (directSignature !== verificationHeaders.headers.signature) {
    throw new Error(
        'valence auth vector mismatch between generateVerificationHeaders() and a direct nacl.sign.detached() call — refusing to emit a bad vector',
    );
}

const valenceAuth = {
    address: valenceAddress,
    public_key: getBytesHexString(valenceKeyPair.publicKey),
    signature: directSignature,
};

/* -------------------------------------------------------------------------- */
/* (d) sample plaintext Pending2WTxDetails offer object                      */
/* -------------------------------------------------------------------------- */

const pending2WTxDetails = initIPending2WTxDetails({
    druid: DRUID,
    senderExpectation,
    receiverExpectation,
    status: 'pending',
    mempoolHost: 'https://mempool.lineage.to',
});

/* -------------------------------------------------------------------------- */
/* Assemble and write twoway.json                                             */
/* -------------------------------------------------------------------------- */

const twoway = {
    druid: DRUID,
    fixedKeypairs: {
        // The 3 addresses supplying inputs for this tx half (from ADDRESS_LIST_TEST).
        ours: Object.keys(ADDRESS_LIST_TEST).map((address) => ({
            address,
            public_key: ADDRESS_LIST_TEST[address].public_key,
            secret_key: ADDRESS_LIST_TEST[address].secret_key,
            address_version: ADDRESS_LIST_TEST[address].address_version,
        })),
        // Fixed deterministic counterparty keypair (seed '11'.repeat(32)); used as the
        // `theirAddress` referenced by senderExpectation/receiverExpectation below. Included
        // so downstream SDKs can also construct the mirrored RECEIVE half if needed.
        counterparty: {
            address: theirAddress,
            public_key: hex(counterparty.publicKey),
            secret_key: hex(counterparty.secretKey),
            address_version: null,
        },
    },
    create2WTxHalf: {
        input: {
            fetchBalanceResponse: FETCH_BALANCE_RESPONSE_TEST,
            senderExpectation,
            receiverExpectation,
            excessAddress,
            locktime: 0,
        },
        output: {
            druid_info: createTx.druid_info,
            outputs: createTx.outputs,
            inputs,
            usedAddresses,
            excessAddressUsed: createTransaction.excessAddressUsed,
        },
    },
    constructTxInsAddress: {
        input: inputs,
        address: txInsAddress,
    },
    valenceAuth,
    pending2WTxDetailsOffer: pending2WTxDetails,
};

fs.writeFileSync('twoway.json', JSON.stringify(twoway, null, 2));

// eslint-disable-next-line no-console
console.log('wrote twoway.json');
