-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('menu', 'button', 'api', 'data');

-- CreateEnum
CREATE TYPE "PluginInstallationStatus" AS ENUM ('uninstalled', 'installed', 'enabled', 'failed');

-- CreateEnum
CREATE TYPE "PluginOperationStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "sys_user" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "real_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "is_super_admin" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sys_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_role" (
    "id" TEXT NOT NULL,
    "role_code" TEXT NOT NULL,
    "role_name" TEXT NOT NULL,
    "data_scope" TEXT NOT NULL DEFAULT 'all',
    "status" TEXT NOT NULL DEFAULT 'active',
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sys_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_permission" (
    "id" TEXT NOT NULL,
    "permission_code" TEXT NOT NULL,
    "permission_name" TEXT NOT NULL,
    "resource_type" "ResourceType" NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "api_path" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sys_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_menu" (
    "id" TEXT NOT NULL,
    "parent_id" TEXT,
    "title" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "icon" TEXT,
    "type" TEXT NOT NULL DEFAULT 'menu',
    "permission_code" TEXT,
    "plugin_code" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sys_menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_user_role" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,

    CONSTRAINT "sys_user_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_role_permission" (
    "id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,

    CONSTRAINT "sys_role_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sys_role_menu" (
    "id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "menu_id" TEXT NOT NULL,

    CONSTRAINT "sys_role_menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_user" (
    "id" TEXT NOT NULL,
    "username" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "nickname" TEXT NOT NULL,
    "avatar" TEXT,
    "password_hash" TEXT,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" TIMESTAMP(3),
    "password_changed_at" TIMESTAMP(3),
    "email_verified_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "member_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_auth_session" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "device_hash" TEXT NOT NULL,
    "device_summary" TEXT NOT NULL,
    "ip_hash" TEXT NOT NULL,
    "region_summary" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "client_auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_auth_one_time_token" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "client_auth_one_time_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_consent_record" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "consent_type" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "text_version" TEXT NOT NULL,
    "text_digest" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "client_consent_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_auth_rate_bucket" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blocked_until" TIMESTAMP(3),
    "last_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "client_auth_rate_bucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_profile" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_entity" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "organization_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_profile" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_entity" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "brand" JSONB,
    "environment" TEXT NOT NULL DEFAULT 'development',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "project_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoped_config" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "plugin_code" TEXT NOT NULL DEFAULT '',
    "config_key" TEXT NOT NULL,
    "config_value" TEXT NOT NULL,
    "value_type" TEXT NOT NULL DEFAULT 'string',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "scoped_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuration_change" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL DEFAULT 'configuration.changed',
    "scope" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "plugin_code" TEXT NOT NULL DEFAULT '',
    "config_key" TEXT NOT NULL,
    "operator_id" TEXT,
    "operator_name" TEXT,
    "change_metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'recorded',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "config_id" TEXT,
    "config_version" INTEGER,
    "audit_log_id" TEXT,

    CONSTRAINT "configuration_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secret_reference" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_checked_at" TIMESTAMP(3),
    "last_check_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "secret_reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "user_id" TEXT,
    "user_name" TEXT,
    "method" TEXT,
    "path" TEXT,
    "request_summary" JSONB,
    "status" TEXT NOT NULL DEFAULT 'success',
    "error_message" TEXT,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "before_data" JSONB,
    "after_data" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "workspace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_asset" (
    "id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storage_type" TEXT NOT NULL DEFAULT 'local',
    "object_key" TEXT,
    "checksum" TEXT,
    "project_id" TEXT,
    "workspace_id" TEXT,
    "plugin_code" TEXT,
    "owner_type" TEXT NOT NULL DEFAULT 'user',
    "owner_id" TEXT,
    "uploader_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "file_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugin_installation" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "plugin_code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "status" "PluginInstallationStatus" NOT NULL DEFAULT 'uninstalled',
    "installed_at" TIMESTAMP(3),
    "enabled_at" TIMESTAMP(3),
    "disabled_at" TIMESTAMP(3),
    "uninstalled_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugin_installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugin_operation" (
    "id" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "status" "PluginOperationStatus" NOT NULL DEFAULT 'pending',
    "failure_reason" TEXT,
    "operator_id" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plugin_operation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sys_user_username_key" ON "sys_user"("username");

-- CreateIndex
CREATE UNIQUE INDEX "sys_role_role_code_key" ON "sys_role"("role_code");

-- CreateIndex
CREATE UNIQUE INDEX "sys_permission_permission_code_key" ON "sys_permission"("permission_code");

-- CreateIndex
CREATE UNIQUE INDEX "sys_menu_path_key" ON "sys_menu"("path");

-- CreateIndex
CREATE INDEX "sys_menu_parent_id_idx" ON "sys_menu"("parent_id");

-- CreateIndex
CREATE INDEX "sys_menu_status_idx" ON "sys_menu"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sys_user_role_user_id_role_id_key" ON "sys_user_role"("user_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_role_permission_role_id_permission_id_key" ON "sys_role_permission"("role_id", "permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "sys_role_menu_role_id_menu_id_key" ON "sys_role_menu"("role_id", "menu_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_user_username_key" ON "member_user"("username");

-- CreateIndex
CREATE UNIQUE INDEX "member_user_mobile_key" ON "member_user"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "member_user_email_key" ON "member_user"("email");

-- CreateIndex
CREATE INDEX "member_user_status_idx" ON "member_user"("status");

-- CreateIndex
CREATE INDEX "client_auth_session_member_status_seen_idx" ON "client_auth_session"("member_id", "status", "last_seen_at");

-- CreateIndex
CREATE INDEX "client_auth_session_expires_idx" ON "client_auth_session"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "client_auth_one_time_token_token_hash_key" ON "client_auth_one_time_token"("token_hash");

-- CreateIndex
CREATE INDEX "client_auth_token_member_purpose_created_idx" ON "client_auth_one_time_token"("member_id", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "client_auth_token_purpose_expires_idx" ON "client_auth_one_time_token"("purpose", "expires_at");

-- CreateIndex
CREATE INDEX "client_consent_member_type_captured_idx" ON "client_consent_record"("member_id", "consent_type", "captured_at");

-- CreateIndex
CREATE INDEX "client_auth_rate_bucket_scope_blocked_until_idx" ON "client_auth_rate_bucket"("scope", "blocked_until");

-- CreateIndex
CREATE INDEX "client_auth_rate_bucket_window_started_at_idx" ON "client_auth_rate_bucket"("window_started_at");

-- CreateIndex
CREATE UNIQUE INDEX "client_auth_rate_bucket_scope_key_hash_key" ON "client_auth_rate_bucket"("scope", "key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "organization_profile_code_key" ON "organization_profile"("code");

-- CreateIndex
CREATE INDEX "organization_profile_status_idx" ON "organization_profile"("status");

-- CreateIndex
CREATE UNIQUE INDEX "project_profile_code_key" ON "project_profile"("code");

-- CreateIndex
CREATE INDEX "project_profile_organization_id_status_idx" ON "project_profile"("organization_id", "status");

-- CreateIndex
CREATE INDEX "scoped_config_scope_scope_id_status_idx" ON "scoped_config"("scope", "scope_id", "status");

-- CreateIndex
CREATE INDEX "scoped_config_plugin_code_config_key_idx" ON "scoped_config"("plugin_code", "config_key");

-- CreateIndex
CREATE UNIQUE INDEX "scoped_config_scope_scope_id_plugin_code_config_key_key" ON "scoped_config"("scope", "scope_id", "plugin_code", "config_key");

-- CreateIndex
CREATE INDEX "configuration_change_audit_log_id_idx" ON "configuration_change"("audit_log_id");

-- CreateIndex
CREATE INDEX "configuration_change_scope_scope_id_created_at_idx" ON "configuration_change"("scope", "scope_id", "created_at");

-- CreateIndex
CREATE INDEX "configuration_change_config_key_idx" ON "configuration_change"("config_key");

-- CreateIndex
CREATE UNIQUE INDEX "configuration_change_config_id_config_version_key" ON "configuration_change"("config_id", "config_version");

-- CreateIndex
CREATE UNIQUE INDEX "secret_reference_ref_key" ON "secret_reference"("ref");

-- CreateIndex
CREATE INDEX "secret_reference_provider_status_idx" ON "secret_reference"("provider", "status");

-- CreateIndex
CREATE INDEX "audit_log_user_id_idx" ON "audit_log"("user_id");

-- CreateIndex
CREATE INDEX "audit_log_user_name_idx" ON "audit_log"("user_name");

-- CreateIndex
CREATE INDEX "audit_log_module_idx" ON "audit_log"("module");

-- CreateIndex
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "audit_log_workspace_created_idx" ON "audit_log"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "file_asset_object_key_key" ON "file_asset"("object_key");

-- CreateIndex
CREATE INDEX "file_asset_uploader_id_idx" ON "file_asset"("uploader_id");

-- CreateIndex
CREATE INDEX "file_asset_project_id_plugin_code_idx" ON "file_asset"("project_id", "plugin_code");

-- CreateIndex
CREATE INDEX "file_asset_workspace_plugin_idx" ON "file_asset"("workspace_id", "plugin_code");

-- CreateIndex
CREATE INDEX "file_asset_owner_type_owner_id_idx" ON "file_asset"("owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "file_asset_status_idx" ON "file_asset"("status");

-- CreateIndex
CREATE UNIQUE INDEX "file_asset_id_workspace_key" ON "file_asset"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "plugin_installation_status_idx" ON "plugin_installation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "plugin_installation_project_id_plugin_code_key" ON "plugin_installation"("project_id", "plugin_code");

-- CreateIndex
CREATE INDEX "plugin_operation_installation_id_created_at_idx" ON "plugin_operation"("installation_id", "created_at");

-- CreateIndex
CREATE INDEX "plugin_operation_status_created_at_idx" ON "plugin_operation"("status", "created_at");

-- AddForeignKey
ALTER TABLE "sys_user_role" ADD CONSTRAINT "sys_user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "sys_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_user_role" ADD CONSTRAINT "sys_user_role_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "sys_role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_role_permission" ADD CONSTRAINT "sys_role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "sys_role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_role_permission" ADD CONSTRAINT "sys_role_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "sys_permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_role_menu" ADD CONSTRAINT "sys_role_menu_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "sys_role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sys_role_menu" ADD CONSTRAINT "sys_role_menu_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "sys_menu"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_auth_session" ADD CONSTRAINT "client_auth_session_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_auth_one_time_token" ADD CONSTRAINT "client_auth_one_time_token_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_consent_record" ADD CONSTRAINT "client_consent_record_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_profile" ADD CONSTRAINT "project_profile_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuration_change" ADD CONSTRAINT "configuration_change_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "scoped_config"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuration_change" ADD CONSTRAINT "configuration_change_audit_log_id_fkey" FOREIGN KEY ("audit_log_id") REFERENCES "audit_log"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_operation" ADD CONSTRAINT "plugin_operation_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "plugin_installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

