# vectorgen

`gen-2way.ts` is the golden-vector generator for the shared `twoway.json` fixture consumed
by every Lineage SDK (sdk-go, sdk-php, sdk-laravel, sdk-rust, sdk-python) so each SDK's
2-way-payment construction can be tested byte-for-byte against sdk-js — the canonical
reference implementation. Unlike the 1-way vector generator (`sdk-go/internal/vectorgen/gen.ts`,
historically copied in and deleted after each run), this script lives in sdk-js itself since
it needs to keep pace with `create2WTxHalf`/`constructTxInsAddress` as they evolve here.

It is **not** compiled or run as part of sdk-js's own build or test suite — it imports
internal, unexported crypto/tx-construction primitives directly from `src/`, so it must be
compiled and run manually against a built sdk-js checkout.

Every vector is produced from fixed inputs (a fixed DRUID, fixed balance/keypairs, fixed
expectations, a fixed excess address, a fixed deterministic counterparty keypair) so
re-running this script against the same sdk-js commit reproduces byte-identical JSON.
Nothing here re-implements sdk-js crypto or transaction-construction logic; it only calls
the real `create2WTxHalf`, `constructTxInsAddress`, and `generateVerificationHeaders`
functions and dumps their outputs.

## Regenerating `twoway.json`

```bash
cd sdk-js
npm ci
npm run build

# Standalone `tsc` on a single file misses the project's `typeRoots` (src/declaration.d.ts,
# which augments bitcore-lib/HDPrivateKey etc.) unless that file is passed alongside it.
npx tsc internal/vectorgen/gen-2way.ts src/declaration.d.ts \
  --module commonjs --target ES2019 --esModuleInterop --skipLibCheck \
  --resolveJsonModule --outDir internal/vectorgen/out

node internal/vectorgen/out/internal/vectorgen/gen-2way.js
# -> wrote twoway.json (in the sdk-js repo root)

# Copy into every SDK's fixtures directory that exists, e.g.:
cp twoway.json /path/to/sdk-go/internal/testvectors/twoway.json
cp twoway.json /path/to/sdk-php/tests/fixtures/twoway.json
cp twoway.json /path/to/sdk-laravel/tests/fixtures/twoway.json

# Clean up — twoway.json and the compiled output are not committed to sdk-js.
rm -rf internal/vectorgen/out twoway.json
```

## Fixed inputs

- DRUID: `DRUID0xf1d2d2f924e986ac86fdf7b36c94bcdf` — a fixed, injected value (NOT randomly
  generated via `generateDRUID()`), so downstream SDK tests are deterministic.
- Balance/keypairs: `FETCH_BALANCE_RESPONSE_TEST`/`ADDRESS_LIST_TEST` from
  `src/tests/constants.ts` — the same fixed 3-address, 3-UTXO fixture used by
  `src/tests/__tests__/item.mgmt.test.ts` and correlated with `fleet`'s
  `crates/prime/src/utils/transaction_utils.rs` server-side tests (same outpoints
  `000000`/`000001`/`000002` and the same 3 public keys).
- Counterparty keypair: `generateKeypair(null, seed)` with a fixed 32-byte seed
  (`'11'.repeat(32)`), used as the external party's address in the expectations below.

## What's in `twoway.json`

- `druid` — the fixed DRUID string.
- `fixedKeypairs.ours` — the 3 `ADDRESS_LIST_TEST` keypairs supplying inputs.
  `fixedKeypairs.counterparty` — the fixed deterministic counterparty keypair.
- `create2WTxHalf.input` — the exact arguments passed to `create2WTxHalf` (balance,
  `senderExpectation`, `receiverExpectation`, `excessAddress`, `locktime`).
- `create2WTxHalf.output` — the real result: `druid_info` (participants: 2), `outputs`,
  per-input `{previous_out, script_signature: {Pay2PkH: {signable_data, signature,
  public_key, address_version}}}`, `usedAddresses`, `excessAddressUsed`.
- `constructTxInsAddress` — the same inputs run through `constructTxInsAddress()`, and the
  resulting address. Cross-checked byte-for-byte against `fleet`'s
  `construct_tx_ins_address`/`construct_tx_in_out_signable_hash` (see fleet task-1 report).
- `valenceAuth` — `{address, public_key, signature}` for a fixed address+secret key, i.e.
  `generateVerificationHeaders()`'s output, cross-checked against a direct
  `nacl.sign.detached(utf8(address), secretKey)` call.
- `pending2WTxDetailsOffer` — a sample plaintext `IPending2WTxDetails` offer object
  (`{druid, senderExpectation, receiverExpectation, status: "pending", mempoolHost}`).

## Note: why this deviates from `item.mgmt.test.ts:89-210`'s literal address strings

That golden test passes non-hex placeholders (`'our_receive_address'`, `'excess_address'`,
`'their_receive_address'`) into fields that `createTx()` validates with `validateAddress()`
(`^[a-f0-9]{64}$`). As a result, `create2WTxHalf` actually returns `Err(InvalidInputs)` for
those literal inputs — the test's assertions live inside `if (createTransaction.isOk())` and
never execute, so the test passes vacuously without the described values ever being
produced. This generator keeps the same fixed balance/keypairs/asset amounts but substitutes
real 64-hex-char addresses (two of the existing fixed test addresses, plus the fixed
counterparty keypair) everywhere an address is expected, so `create2WTxHalf` actually
succeeds and the emitted vectors are real, reproducible output.
