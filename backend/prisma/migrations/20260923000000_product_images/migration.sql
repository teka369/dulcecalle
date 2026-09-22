-- ProductImage: Cloudinary-backed product gallery. PostgreSQL owns the
-- product ↔ image relation; Cloudinary stores and delivers the bytes.
CREATE TABLE "product_images" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "cloudinary_asset_id" TEXT,
  "public_id" TEXT NOT NULL,
  "secure_url" TEXT NOT NULL,
  "version" INTEGER,
  "width" INTEGER,
  "height" INTEGER,
  "format" TEXT,
  "bytes" INTEGER,
  "position" INTEGER NOT NULL DEFAULT 0,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "alt_text" TEXT,
  "request_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_images_public_id_key" ON "product_images"("public_id");
CREATE UNIQUE INDEX "product_images_business_id_request_id_key" ON "product_images"("business_id", "request_id");
CREATE INDEX "product_images_business_id_product_id_position_idx" ON "product_images"("business_id", "product_id", "position");

ALTER TABLE "product_images" ADD CONSTRAINT "product_images_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
