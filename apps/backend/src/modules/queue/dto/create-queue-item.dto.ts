import { IsInt, IsPositive, IsString, Min } from "class-validator";

export class CreateQueueItemDto {
  @IsString()
  youtube_id!: string;

  @IsString()
  title!: string;

  @IsInt()
  @Min(1)
  duration!: number;

  @IsInt()
  @IsPositive()
  table_id!: number;
}
