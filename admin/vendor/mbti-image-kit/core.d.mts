export function makeGateway(options?: {
  upstream?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  now?: () => number
}): (request: Pick<Request, 'url' | 'method' | 'headers' | 'body'>, env?: Record<string, string>, mode?: string) => Promise<Response>
