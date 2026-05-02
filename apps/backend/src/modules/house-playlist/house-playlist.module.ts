import { Module } from "@nestjs/common";
import { HousePlaylistController } from "./house-playlist.controller";
import { HousePlaylistService } from "./house-playlist.service";

@Module({
  controllers: [HousePlaylistController],
  providers: [HousePlaylistService],
  exports: [HousePlaylistService],
})
export class HousePlaylistModule {}
