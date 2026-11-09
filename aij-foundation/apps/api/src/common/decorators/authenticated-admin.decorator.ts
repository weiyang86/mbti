import { SetMetadata } from "@nestjs/common";

export const AUTHENTICATED_ADMIN_KEY = "aij:authenticated-admin";
// Method-only exception for identity/own-permission reads; never a public endpoint.
export const AuthenticatedAdmin = () => SetMetadata(AUTHENTICATED_ADMIN_KEY, true);
