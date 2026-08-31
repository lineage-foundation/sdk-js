import axios from 'axios';
import nock from 'nock';

afterEach(() => {
    nock.cleanAll();
});

test('nock intercepts an axios call under jest', async () => {
    const scope = nock('http://smoke-test.local').get('/ping').reply(200, { pong: true });

    const response = await axios.get('http://smoke-test.local/ping');

    expect(response.data).toEqual({ pong: true });
    expect(scope.isDone()).toBe(true);
});
