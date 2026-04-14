import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage("table:join")
  handleTableJoin(
    @MessageBody() tableId: number,
    @ConnectedSocket() client: Socket,
  ) {
    const roomName = this.getTableRoom(tableId);
    void client.join(roomName);
    this.logger.log(`Client ${client.id} joined ${roomName}`);
  }

  emitQueueUpdated(payload: unknown) {
    this.server.emit("queue:updated", payload);
  }

  emitOrderUpdated(payload: unknown) {
    this.server.emit("order:updated", payload);
  }

  emitTableUpdated(payload: unknown) {
    this.server.emit("table:updated", payload);
  }

  emitPlaybackUpdated(payload: unknown) {
    this.server.emit("playback:updated", payload);
  }

  private getTableRoom(tableId: number) {
    return `table:${tableId}`;
  }
}
