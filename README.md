# Lineage JavaScript SDK

JavaScript/TypeScript SDK for the Lineage `/v1` REST API: a key-holding wallet that derives addresses and signs transactions locally.

## Installation

Published on [npm](https://www.npmjs.com/package/@lineage-foundation/sdk-js) as `@lineage-foundation/sdk-js`.

```sh
npm install @lineage-foundation/sdk-js
```

## Configuration

```typescript
const config = {
    mempoolHost: 'https://mempool.lineage.to',
    storageHost: 'https://storage.lineage.to', // optional
    valenceHost: 'https://valence.lineage.to', // optional, required for 2-way payments
    apiKey: 'your-api-key', // optional, sent as the x-api-key header
    passphrase: 'a secure passphrase',
};
```

## Quickstart

```typescript
import { Wallet } from '@lineage-foundation/sdk-js';

const wallet = new Wallet();

// Create a new wallet (or wallet.fromSeed(seedPhrase, config) to restore one)
const init = await wallet.initNew(config);
const { seedphrase, masterKey } = init.content.initNewResponse;
displayOnce(seedphrase); // show once, then never persist it
saveMasterKey(masterKey); // persist the encrypted master key instead

// Derive a keypair and check its balance
const keypair = wallet.getNewKeypair([]).content.newKeypairResponse;
const { fetchBalanceResponse: balance } = (await wallet.fetchBalance([keypair.address])).content;

// Pay 10 tokens to another address, sending any change back to the same keypair
await wallet.makeTokenPayment('d0e72...85b46', 10, [keypair], keypair);
```

## Two-way (DRUID) payments

DRUID-based dual double-entry trades: two parties each pay an asset to the other, atomically correlated by a shared DRUID, and coordinated out-of-band through a plaintext valence mailbox host (`valenceHost`).

```typescript
// A offers to pay sendingAsset to paymentAddress for receivingAsset delivered
// to receiveKeypair's address. Persist the encrypted tx until settlement.
const offer = await wallet.make2WayPayment(
    paymentAddress, // B's address
    sendingAsset, // e.g. { Item: { amount: 50, genesis_hash, metadata: null } }
    receivingAsset, // e.g. { Token: 100 }
    allKeypairs, // A's keypairs funding sendingAsset
    receiveKeypair, // A's keypair to receive receivingAsset
);
const { druid, encryptedTx } = offer.content.make2WayPaymentResponse;
saveEncryptedTx(druid, encryptedTx);

// B polls its own mailbox for incoming offers
const pending = await wallet.fetchPending2WayPayment(keypair, allEncryptedTxs);
const details = pending.content.fetchPending2WResponse[druid];

// B accepts (submits its half, settles atomically) or rejects (notifies valence only)
await wallet.accept2WayPayment(details.druid, details, allKeypairs);
await wallet.reject2WayPayment(details.druid, details, allKeypairs);
```

Two-way trades interoperate across all the SDKs and settle atomically through the mempool's DRUID pool, so either party can be on any SDK.

## Wire compatibility

Keys and signatures are byte-for-byte compatible across every Lineage SDK — a wallet (mnemonic) created in one derives the same addresses and produces the same signatures in all of them. sdk-js is the reference implementation; BIP39/BIP32 derivation, SHA3-256 addresses, ed25519 signing, and the `/v1` transaction serialization (field order is load-bearing — you sign exactly what you submit) all match it exactly.

## Testing

```sh
npm test
```

The suite is offline by default. `valence.local-e2e.test.ts` drives a full two-wallet 2-way swap against a live local mempool/storage/valence stack and only runs with `RUN_LOCAL_E2E=1`.

## Lineage SDKs

- [JavaScript / TypeScript](https://github.com/lineage-foundation/sdk-js)
- [Python](https://github.com/lineage-foundation/sdk-python)
- [Go](https://github.com/lineage-foundation/sdk-go)
- [Rust](https://github.com/lineage-foundation/sdk-rust)
- [PHP](https://github.com/lineage-foundation/sdk-php)
- [Laravel](https://github.com/lineage-foundation/sdk-laravel)

## License

MIT — see [LICENSE](LICENSE).
