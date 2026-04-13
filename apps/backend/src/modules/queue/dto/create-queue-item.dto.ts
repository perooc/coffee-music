import { IsInt, IsNotEmpty, IsPositive, IsString, Max, Min } from "class-validator";
import { MAX_SONG_DURATION_SECONDS } from "@coffee-bar/shared";

export class CreateQueueItemDto {
  @IsString()
  @IsNotEmpty()
  youtube_id!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_SONG_DURATION_SECONDS)
  duration!: number;

  @IsInt()
  @IsPositive()
  table_id!: number;
}
