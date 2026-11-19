-- AlterTable
ALTER TABLE "sys_user" ADD COLUMN     "token_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "admin_auth_session" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'bearer',
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" TEXT,

    CONSTRAINT "admin_auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_auth_session_user_id_namespace_revoked_at_idx" ON "admin_auth_session"("user_id", "namespace", "revoked_at");

-- CreateIndex
CREATE INDEX "admin_auth_session_expires_at_idx" ON "admin_auth_session"("expires_at");

-- AddForeignKey
ALTER TABLE "admin_auth_session" ADD CONSTRAINT "admin_auth_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
