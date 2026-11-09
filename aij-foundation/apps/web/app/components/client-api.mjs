import { ClientRequestFailure, clientRequestMessage, createClientApi } from "@aij/sdk";

export { ClientRequestFailure, clientRequestMessage };
export const clientApi = createClientApi(() => process.env.NEXT_PUBLIC_API_URL);
