declare module "embedded-postgres" {
  export default class EmbeddedPostgres {
    constructor(options?: Record<string, unknown>);
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    createDatabase(name: string): Promise<void>;
  }
}

declare module "pg" {
  export class Client {
    constructor(config?: {
      host?: string;
      port?: number;
      user?: string;
      database?: string;
      password?: string;
    });
    connect(): Promise<void>;
    query(text: string): Promise<unknown>;
    end(): Promise<void>;
  }
}
