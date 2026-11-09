import { Module } from "@nestjs/common";
import { MbtiController } from "./mbti.controller";
import { MbtiGuestGuard } from "./mbti.http";
import { MbtiService } from "./mbti.service";
import { MbtiShareService } from "./mbti-share.service";

@Module({ controllers: [MbtiController], providers: [MbtiService, MbtiShareService, MbtiGuestGuard], exports: [MbtiService, MbtiGuestGuard] })
export class MbtiModule {}
