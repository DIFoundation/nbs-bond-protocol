import axios, { AxiosRequestConfig } from 'axios';

/**
 * Minimal HTTP surface used by every oracle adapter.
 *
 * Adapters never touch axios directly — they talk to this interface so that
 * upstream responses can be mocked in tests and swapped for a local-file
 * transport when running against test data (see `oracle/run.ts`).
 */
export interface HttpClient {
  get<T>(url: string, config?: RequestOptions): Promise<HttpResponse<T>>;
  post<T>(url: string, body: unknown, config?: RequestOptions): Promise<HttpResponse<T>>;
}

export interface HttpResponse<T> {
  status: number;
  data: T;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export function createAxiosHttpClient(timeoutMs = 15_000): HttpClient {
  return {
    async get<T>(url: string, config: RequestOptions = {}): Promise<HttpResponse<T>> {
      const options: AxiosRequestConfig = {
        timeout: config.timeoutMs ?? timeoutMs,
        headers: config.headers,
      };
      const response = await axios.get<T>(url, options);
      return { status: response.status, data: response.data };
    },
    async post<T>(url: string, body: unknown, config: RequestOptions = {}): Promise<HttpResponse<T>> {
      const options: AxiosRequestConfig = {
        timeout: config.timeoutMs ?? timeoutMs,
        headers: config.headers,
      };
      const response = await axios.post<T>(url, body, options);
      return { status: response.status, data: response.data };
    },
  };
}
