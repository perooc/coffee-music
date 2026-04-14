CREATE TYPE "PlaybackStatus" AS ENUM ('idle', 'playing', 'paused');

CREATE TABLE "PlaybackState" (
  "id" SERIAL NOT NULL,
  "status" "PlaybackStatus" NOT NULL DEFAULT 'idle',
  "queue_item_id" INTEGER,
  "started_at" TIMESTAMP(3),
  "position_seconds" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaybackState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlaybackState_queue_item_id_key" ON "PlaybackState"("queue_item_id");

ALTER TABLE "PlaybackState"
ADD CONSTRAINT "PlaybackState_queue_item_id_fkey"
FOREIGN KEY ("queue_item_id") REFERENCES "QueueItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
