/* -------------------------------------------------------------------------- */
/*                                 API Routes                                 */
/* -------------------------------------------------------------------------- */

import {
    IAssetItem,
    IAssetToken,
    ICreateTransaction,
    ICreateTransactionEncrypted,
    IDruidDroplet,
    IDruidExpectation,
    IGenericKeyPair,
    IKeypair,
    IKeypairEncrypted,
    IMasterKeyEncrypted,
    INewWalletResponse,
    IOutPoint,
    ITransaction,
} from './general.interfaces';

// Response structure returned from `Wallet` methods
export type IClientResponse = {
    id?: string;
    status: 'success' | 'error' | 'pending' | 'unknown';
    reason?: string;
    content?: IContentType;
};

// `content` field of `IClientResponse`
export type IContentType = {
    newDRUIDResponse?: string;
    newSeedPhraseResponse?: string;
    getSeedPhraseResponse?: string;
    make2WayPaymentResponse?: IMake2WPaymentResponse;
    newKeypairResponse?: IKeypairEncrypted;
    getMasterKeyResponse?: IMasterKeyEncrypted;
    initNewResponse?: INewWalletResponse;
    fromSeedResponse?: IMasterKeyEncrypted;
    regenWalletResponse?: IKeypairEncrypted[];
    signMessageResponse?: IGenericKeyPair<string>;
    decryptKeypairResponse?: IKeypair;
    saveKeypairResponse?: string[];
    getKeypairsResponse?: IKeypairEncrypted[];
} & IApiContentType;

// Content received from mempool node / valence server API endpoints
export type IApiContentType = {
    fetchBalanceResponse?: IFetchBalanceResponse;
    createItemResponse?: ICreateItemResponse;
    fetchPending2WResponse?: IPending2WResponse;
    fetchTransactionsResponse?: IFetchTransactionsResponse;
    makePaymentResponse?: IMakePaymentResponse;
};

export enum IAPIRoute {
    /* ------------------------------- MEMPOOL Network Routes ------------------------------- */
    FetchBalance = '/v1/balances/query',
    CreateTransactions = '/v1/transactions',
    CreateItemAsset = '/v1/items',
    FetchPending = '/fetch_pending',
    /* --------------------------- Storage Network Routes --------------------------- */
    BlockchainEntry = '/v1/blockchain-entries/query',
    /* ----------------------------- Valence Routes ---------------------------- */
    ValenceSet = '/set_data',
    ValenceGet = '/get_data',
    ValenceDel = '/del_data',
}

/* -------------------------------------------------------------------------- */
/*                               Network Interfaces                               */
/* -------------------------------------------------------------------------- */

/* --------------------------- Response Structures -------------------------- */

// Response structure received from mempool API endpoints
export type INetworkResponse = {
    id?: string;
    status: 'Success' | 'Error' | 'InProgress' | 'Unknown';
    reason?: string;
    route?: string;
    content?: IApiContentType;
};

// Chain asset as returned by the `/v1` write endpoints, tagged by `kind`
export type IApiAsset =
    | { kind: 'token'; amount: number }
    | { kind: 'item'; amount: number; genesis_hash: string | null; metadata: string | null };

// `transactions` field of the `POST /v1/transactions` response, keyed by transaction hash
export type IApiCreateTxResponse = IGenericKeyPair<{ address: string; asset: IApiAsset }>;

// `POST /v1/transactions` endpoint response
export type ICreateTransactionsResponse = {
    transactions: IApiCreateTxResponse;
};

export type IMakePaymentResponse = {
    transactionHash: string;
    paymentAddress: string;
    asset: IApiAsset;
    usedAddresses: string[];
};

// `/v1/blockchain-entries/query` entry metadata (block or transaction position)
export type IBlockchainItemMeta =
    | { type: 'block'; block_num: number; tx_len: number }
    | { type: 'tx'; block_num: number; tx_num: number };

// A single stored blockchain entry, as returned by `/v1/blockchain-entries/query`
export type IBlockchainEntry = {
    key: string;
    item_meta: IBlockchainItemMeta;
    data: ITransaction | unknown;
};

export type IFetchTransactionsResponse = IBlockchainEntry[];

// `application/problem+json` error body returned by the `/v1` API on non-2xx responses
export type IApiProblemResponse = {
    type?: string;
    title?: string;
    status?: number;
    detail?: string;
    code?: string;
};

// `/v1/balances/query` endpoint response (the `balance` field of the response body)
export type IFetchBalanceResponse = {
    total: {
        tokens: number;
        items: IGenericKeyPair<number>;
    };
    address_list: IGenericKeyPair<{ out_point: IOutPoint; value: IAssetItem | IAssetToken }[]>;
};

// `POST /v1/items` endpoint response
export type ICreateItemResponse = {
    asset: IApiAsset; // `{ kind: 'item', amount, genesis_hash, metadata }`
    to_address: string;
    tx_hash: string;
};

// `/fetch_pending` endpoint response
export type IFetchPending2WayResponse = {
    pending_transactions: { [key: string]: IDruidDroplet[] };
};

/* --------------------------- Payload Structures --------------------------- */

export enum IGenesisHashSpecification {
    Create = 'Create',
    Default = 'Default',
}

// Client-signed item-creation payload built by `createItemPayload`. `version` is kept
// here (and still returned by `createItemPayload`) since it's part of the address-derivation
// context, but it is dropped from the `POST /v1/items` request body - the `/v1` DTO has no
// such field.
export type IItemCreationAPIPayload = {
    item_amount: number;
    script_public_key: string;
    public_key: string;
    signature: string;
    version: number | null;
    genesis_hash_spec: IGenesisHashSpecification;
    metadata: string | null;
};
// `/create_transactions` payload structure
export type ICreateTxPayload = {
    createTx: ICreateTransaction;
    excessAddressUsed: boolean;
    usedAddresses: string[];
};

/* -------------------------------------------------------------------------- */
/*                          Valence Interfaces                                */
/* -------------------------------------------------------------------------- */

export type IRequestValenceResponse = {
    status: 'Success' | 'Error' | 'InProgress' | 'Unknown';
    reason?: string;
    route?: string;
    content?: IApiContentType;
};

export type IRequestValenceSetBody<T> = {
    address: string;
    data: T;
};

export type IPending2WResponse = {
    address: string;
    data: IPending2WTxDetails;
};

// NOTE: This data structure can be changed to anything and it will still be supported by the valence server
export type IPending2WTxDetails = {
    druid: string; // Value to bind transactions together
    senderExpectation: IDruidExpectation;
    receiverExpectation: IDruidExpectation;
    status: 'pending' | 'rejected' | 'accepted'; // Status of the 2 way transaction
    mempoolHost: string; // Correlation between clients; send txs to the same mempool node; chosen by the sender
};

/* -------------------------------------------------------------------------- */
/*                     Wallet Response Interfaces                    */
/* -------------------------------------------------------------------------- */
// Make 2 way payment response
type IMake2WPaymentResponse = {
    druid: string;
    encryptedTx: ICreateTransactionEncrypted;
};
