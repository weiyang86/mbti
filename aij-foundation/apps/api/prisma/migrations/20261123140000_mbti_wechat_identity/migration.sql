-- Mini-program login identity bound to the existing guest data owner.
CREATE TABLE "MbtiWechatIdentity" (
  "id" TEXT NOT NULL,
  "openId" TEXT NOT NULL,
  "unionId" TEXT,
  "guestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MbtiWechatIdentity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MbtiWechatIdentity_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "MbtiGuest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "MbtiWechatIdentity_openId_key" ON "MbtiWechatIdentity"("openId");
CREATE UNIQUE INDEX "MbtiWechatIdentity_guestId_key" ON "MbtiWechatIdentity"("guestId");
