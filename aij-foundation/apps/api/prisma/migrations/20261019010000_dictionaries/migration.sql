-- CreateTable
CREATE TABLE "system_dict" (
    "id" TEXT NOT NULL,
    "dict_code" TEXT NOT NULL,
    "dict_name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "plugin_code" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "system_dict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_dict_item" (
    "id" TEXT NOT NULL,
    "dict_id" TEXT NOT NULL,
    "item_label" TEXT NOT NULL,
    "item_value" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "system_dict_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "system_dict_dict_code_key" ON "system_dict"("dict_code");

-- CreateIndex
CREATE INDEX "system_dict_status_idx" ON "system_dict"("status");

-- CreateIndex
CREATE INDEX "system_dict_item_dict_id_idx" ON "system_dict_item"("dict_id");

-- CreateIndex
CREATE INDEX "system_dict_item_status_idx" ON "system_dict_item"("status");

-- CreateIndex
CREATE UNIQUE INDEX "system_dict_item_dict_id_item_value_key" ON "system_dict_item"("dict_id", "item_value");

-- AddForeignKey
ALTER TABLE "system_dict_item" ADD CONSTRAINT "system_dict_item_dict_id_fkey" FOREIGN KEY ("dict_id") REFERENCES "system_dict"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

