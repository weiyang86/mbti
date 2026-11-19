import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AuthExceptionFilter } from "./auth-exception.filter";

// Shared once by administrator and customer modules, including customer-only hosts.
@Module({ providers: [{ provide: APP_FILTER, useClass: AuthExceptionFilter }] })
export class AuthErrorsModule {}
