-- Official-account (公众号) OAuth identity, kept separate from the mini-program
-- identity because openid is scoped to each WeChat AppID.
CREATE TABLE "MbtiWechatMpIdentity" (
  "id" TEXT NOT NULL,
  "openId" TEXT NOT NULL,
  "unionId" TEXT,
  "guestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MbtiWechatMpIdentity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MbtiWechatMpIdentity_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "MbtiGuest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "MbtiWechatMpIdentity_openId_key" ON "MbtiWechatMpIdentity"("openId");
CREATE UNIQUE INDEX "MbtiWechatMpIdentity_guestId_key" ON "MbtiWechatMpIdentity"("guestId");
