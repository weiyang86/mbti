import { Module } from "@nestjs/common";
import { MbtiController } from "./mbti.controller";
import { MbtiGuestGuard } from "./mbti.http";
import { MbtiService } from "./mbti.service";

@Module({ controllers: [MbtiController], providers: [MbtiService, MbtiGuestGuard], exports: [MbtiService, MbtiGuestGuard] })
export class MbtiModule {}
