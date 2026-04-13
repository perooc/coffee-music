import { Injectable } from "@nestjs/common";

@Injectable()
export class HealthService {
  getHealth() {
    return {
      status: "ok",
      service: "backend",
      timestamp: new Date().toISOString(),
    };
  }
}
