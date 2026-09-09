import { IKeypair, IRequestValenceSetBody } from '../interfaces';
import { createSignature } from '../mgmt/key.mgmt';
import { DEFAULT_HEADERS } from '../mgmt/constants';

/**
 * Generate the needed request body to place data on the valence server
 *
 * @export
 * @template T
 * @param {T} data
 * @param {string} dataId
 * @return {*}  {IRequestValenceSetBody<T>}
 */
export function generateValenceSetBody<T>(data: T, dataId: string): IRequestValenceSetBody<T> {
    return {
        id: dataId,
        data,
    };
}

/**
 * Generate the needed headers to verify the authenticity of the request on Valence nodes
 *
 * @param {string} address
 * @param {IKeypair} keyPair
 * @returns
 */
export function generateVerificationHeaders(address: string, keyPair: IKeypair) {
    return {
        headers: {
            ...DEFAULT_HEADERS.headers,
            address,
            signature: Buffer.from(
                createSignature(keyPair.secretKey, Uint8Array.from(Buffer.from(address))),
            ).toString('hex'),
            public_key: Buffer.from(keyPair.publicKey).toString('hex'),
        },
    };
}
