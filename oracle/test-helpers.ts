import { HttpClient, HttpResponse } from './http';

export interface MockResponse {
  status?: number;
  data: unknown;
}

/**
 * Injectable mock of the upstream HTTP surface. Responses are consumed in
 * order; an explicit error can be queued to exercise error paths.
 */
export class MockHttpClient implements HttpClient {
  calls: Array<{ url: string; method: 'get' | 'post'; body?: unknown }> = [];
  private responses: Array<MockResponse | Error>;

  constructor(responses: Array<MockResponse | Error> = []) {
    this.responses = responses;
  }

  enqueue(response: MockResponse | Error): void {
    this.responses.push(response);
  }

  private take(): MockResponse | Error {
    const response = this.responses.shift();
    if (!response) {
      throw new Error('MockHttpClient: no queued response for request');
    }
    return response;
  }

  private resolve(response: MockResponse | Error): HttpResponse<unknown> {
    if (response instanceof Error) {
      throw response;
    }
    return { status: response.status ?? 200, data: response.data };
  }

  async get<T>(url: string): Promise<HttpResponse<T>> {
    this.calls.push({ url, method: 'get' });
    return this.resolve(this.take()) as HttpResponse<T>;
  }

  async post<T>(url: string, body: unknown): Promise<HttpResponse<T>> {
    this.calls.push({ url, method: 'post', body });
    return this.resolve(this.take()) as HttpResponse<T>;
  }
}
