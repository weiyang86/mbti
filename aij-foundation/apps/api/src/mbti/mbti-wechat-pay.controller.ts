import { Controller, Header, HttpCode, HttpException, Post, Req, Res } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { MbtiWechatPayService } from "./mbti-wechat-pay.service";

type RawRequest = IncomingMessage & { rawBody?: Buffer };

/** WeChat expects its own small acknowledgement body; do not use the MBTI error envelope here. */
@Controller("v1/payments/wechat")
export class MbtiWechatPayController {
  constructor(private readonly payments: MbtiWechatPayService) {}

  @Post("notify")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async notify(@Req() request: RawRequest, @Res() response: ServerResponse) {
    try {
      await this.payments.notify(request.headers, request.rawBody);
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ code: "SUCCESS", message: "成功" }));
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[mbti-wxpay-notify]", error instanceof Error ? error.message : String(error));
      }
      response.statusCode = error instanceof HttpException ? error.getStatus() : 500;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ code: "FAIL", message: "支付回调处理失败" }));
    }
  }
}
