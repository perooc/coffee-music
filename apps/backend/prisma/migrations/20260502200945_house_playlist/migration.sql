-- CreateEnum
CREATE TYPE "QueueItemSource" AS ENUM ('customer', 'house');

-- AlterTable
ALTER TABLE "QueueItem" ADD COLUMN     "source" "QueueItemSource" NOT NULL DEFAULT 'customer';

-- CreateTable
CREATE TABLE "HousePlaylistItem" (
    "id" SERIAL NOT NULL,
    "youtube_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "duration" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "last_played_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HousePlaylistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HousePlaylistItem_youtube_id_key" ON "HousePlaylistItem"("youtube_id");

-- CreateIndex
CREATE INDEX "HousePlaylistItem_is_active_sort_order_idx" ON "HousePlaylistItem"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "HousePlaylistItem_is_active_last_played_at_idx" ON "HousePlaylistItem"("is_active", "last_played_at");

-- CreateIndex
CREATE INDEX "QueueItem_status_source_position_idx" ON "QueueItem"("status", "source", "position");
