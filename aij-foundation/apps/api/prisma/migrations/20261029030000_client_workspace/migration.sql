-- CreateTable
CREATE TABLE "client_workspace" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "created_by_member_id" TEXT NOT NULL,
    "creation_idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "client_workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_workspace_role" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "client_workspace_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_workspace_permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "client_workspace_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_workspace_role_permission" (
    "id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "client_workspace_role_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_workspace_membership" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "session_version" INTEGER NOT NULL DEFAULT 0,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" TIMESTAMP(3),
    "removed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "client_workspace_membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_workspace_code_key" ON "client_workspace"("code");

-- CreateIndex
CREATE INDEX "client_workspace_status_deleted_idx" ON "client_workspace"("status", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "client_workspace_creator_idempotency_key" ON "client_workspace"("created_by_member_id", "creation_idempotency_key");

-- CreateIndex
CREATE INDEX "client_workspace_role_scope_status_sort_idx" ON "client_workspace_role"("workspace_id", "status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "client_workspace_role_workspace_code_key" ON "client_workspace_role"("workspace_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "client_workspace_role_workspace_id_key" ON "client_workspace_role"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "client_workspace_permission_code_key" ON "client_workspace_permission"("code");

-- CreateIndex
CREATE INDEX "client_workspace_permission_status_idx" ON "client_workspace_permission"("status");

-- CreateIndex
CREATE INDEX "client_workspace_role_permission_permission_idx" ON "client_workspace_role_permission"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_workspace_role_permission_key" ON "client_workspace_role_permission"("role_id", "permission_id");

-- CreateIndex
CREATE INDEX "client_workspace_membership_member_status_idx" ON "client_workspace_membership"("member_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "client_workspace_membership_role_status_idx" ON "client_workspace_membership"("workspace_id", "role_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "client_workspace_membership_workspace_member_key" ON "client_workspace_membership"("workspace_id", "member_id");

-- AddForeignKey
ALTER TABLE "client_workspace" ADD CONSTRAINT "client_workspace_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "member_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_workspace_role" ADD CONSTRAINT "client_workspace_role_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "client_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_workspace_role_permission" ADD CONSTRAINT "client_workspace_role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "client_workspace_role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_workspace_role_permission" ADD CONSTRAINT "client_workspace_role_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "client_workspace_permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_workspace_membership" ADD CONSTRAINT "client_workspace_membership_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "client_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_workspace_membership" ADD CONSTRAINT "client_workspace_membership_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_workspace_membership" ADD CONSTRAINT "client_workspace_membership_workspace_id_role_id_fkey" FOREIGN KEY ("workspace_id", "role_id") REFERENCES "client_workspace_role"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
