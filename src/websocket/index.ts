/**
 * WebSocket Helpers
 * 
 * Utilities for WebSocket connections, pub/sub patterns,
 * and real-time communication in Bueno applications.
 */

// ============= Types =============

export interface WebSocketData {
  id: string;
  userId?: string;
  [key: string]: unknown;
}

export interface WebSocketMessage {
  type: string;
  payload: unknown;
  timestamp: number;
}

export interface WebSocketOptions {
  idleTimeout?: number;
  maxPayloadLength?: number;
  perMessageDeflate?: boolean;
}

export type WebSocketHandler = (ws: Bun.ServerWebSocket<WebSocketData>, message: WebSocketMessage) => void | Promise<void>;
export type OpenHandler = (ws: Bun.ServerWebSocket<WebSocketData>) => void | Promise<void>;
export type CloseHandler = (ws: Bun.ServerWebSocket<WebSocketData>, code: number, reason: string) => void | Promise<void>;
export type ErrorHandler = (ws: Bun.ServerWebSocket<WebSocketData>, error: Error) => void | Promise<void>;

// ============= WebSocket Server =============

export interface WebSocketServerOptions extends WebSocketOptions {
  onMessage?: WebSocketHandler;
  onOpen?: OpenHandler;
  onClose?: CloseHandler;
  onError?: ErrorHandler;
}

export class WebSocketServer {
  private options: WebSocketServerOptions;
  private connections: Map<string, Bun.ServerWebSocket<WebSocketData>> = new Map();
  private rooms: Map<string, Set<string>> = new Map();
  private messageHandlers: Map<string, WebSocketHandler[]> = new Map();

  constructor(options: WebSocketServerOptions = {}) {
    this.options = {
      idleTimeout: 255,
      maxPayloadLength: 1024 * 1024, // 1MB
      perMessageDeflate: true,
      ...options,
    };
  }

  /**
   * Get Bun WebSocket configuration
   */
  getWebSocketConfig(): Bun.WebSocketHandler<WebSocketData> {
    return {
      idleTimeout: this.options.idleTimeout,
      maxPayloadLength: this.options.maxPayloadLength,
      perMessageDeflate: this.options.perMessageDeflate,
      
      open: (ws) => {
        this.connections.set(ws.data.id, ws);
        this.options.onOpen?.(ws);
      },
      
      message: (ws, message) => {
        let parsed: WebSocketMessage;
        
        if (typeof message === 'string') {
          try {
            parsed = JSON.parse(message);
          } catch {
            parsed = { type: 'raw', payload: message, timestamp: Date.now() };
          }
        } else {
          parsed = { type: 'binary', payload: message, timestamp: Date.now() };
        }
        
        // Call global handler
        this.options.onMessage?.(ws, parsed);
        
        // Call type-specific handlers
        const handlers = this.messageHandlers.get(parsed.type);
        if (handlers) {
          for (const handler of handlers) {
            handler(ws, parsed);
          }
        }
      },
      
      close: (ws, code, reason) => {
        this.connections.delete(ws.data.id);
        
        // Remove from all rooms
        for (const [room, members] of this.rooms) {
          members.delete(ws.data.id);
        }
        
        this.options.onClose?.(ws, code, reason);
      },
    };
  }

  /**
   * Register a message type handler
   */
  on(type: string, handler: WebSocketHandler): this {
    const handlers = this.messageHandlers.get(type) ?? [];
    handlers.push(handler);
    this.messageHandlers.set(type, handlers);
    return this;
  }

  /**
   * Broadcast to all connections
   */
  broadcast(type: string, payload: unknown): void {
    const message: WebSocketMessage = { type, payload, timestamp: Date.now() };
    const data = JSON.stringify(message);
    
    for (const ws of this.connections.values()) {
      ws.send(data);
    }
  }

  /**
   * Send to specific connection
   */
  send(connectionId: string, type: string, payload: unknown): boolean {
    const ws = this.connections.get(connectionId);
    if (!ws) return false;
    
    const message: WebSocketMessage = { type, payload, timestamp: Date.now() };
    ws.send(JSON.stringify(message));
    return true;
  }

  /**
   * Broadcast to a room
   */
  broadcastToRoom(room: string, type: string, payload: unknown): void {
    const members = this.rooms.get(room);
    if (!members) return;
    
    const message: WebSocketMessage = { type, payload, timestamp: Date.now() };
    const data = JSON.stringify(message);
    
    for (const id of members) {
      const ws = this.connections.get(id);
      if (ws) {
        ws.send(data);
      }
    }
  }

  /**
   * Join a room
   */
  joinRoom(connectionId: string, room: string): void {
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }
    this.rooms.get(room)!.add(connectionId);
  }

  /**
   * Leave a room
   */
  leaveRoom(connectionId: string, room: string): void {
    this.rooms.get(room)?.delete(connectionId);
  }

  /**
   * Get room members
   */
  getRoomMembers(room: string): string[] {
    return Array.from(this.rooms.get(room) ?? []);
  }

  /**
   * Get all connection IDs
   */
  getConnectionIds(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Get connection count
   */
  get connectionCount(): number {
    return this.connections.size;
  }

  /**
   * Check if connection exists
   */
  hasConnection(connectionId: string): boolean {
    return this.connections.has(connectionId);
  }

  /**
   * Close a connection
   */
  closeConnection(connectionId: string, code = 1000, reason = 'Closed by server'): boolean {
    const ws = this.connections.get(connectionId);
    if (!ws) return false;
    
    ws.close(code, reason);
    return true;
  }

  /**
   * Close all connections
   */
  closeAll(code = 1000, reason = 'Server shutting down'): void {
    for (const ws of this.connections.values()) {
      ws.close(code, reason);
    }
  }
}

// ============= WebSocket Client =============

export interface WebSocketClientOptions {
  url: string;
  protocols?: string | string[];
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  onOpen?: () => void;
  onClose?: (event: CloseEvent) => void;
  onMessage?: (message: WebSocketMessage) => void;
  onError?: (event: Event) => void;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private options: WebSocketClientOptions;
  private reconnectAttempts = 0;
  private shouldReconnect = true;
  private messageQueue: string[] = [];

  constructor(options: WebSocketClientOptions) {
    this.options = {
      reconnect: true,
      reconnectInterval: 1000,
      maxReconnectAttempts: 5,
      ...options,
    };
  }

  /**
   * Connect to WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.options.url, this.options.protocols);
        this.shouldReconnect = true;

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          
          // Send queued messages
          while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift()!;
            this.ws!.send(message);
          }
          
          this.options.onOpen?.();
          resolve();
        };

        this.ws.onclose = (event) => {
          this.options.onClose?.(event);
          
          if (this.shouldReconnect && this.options.reconnect) {
            this.attemptReconnect();
          }
        };

        this.ws.onmessage = (event) => {
          let message: WebSocketMessage;
          
          try {
            message = JSON.parse(event.data);
          } catch {
            message = { type: 'raw', payload: event.data, timestamp: Date.now() };
          }
          
          this.options.onMessage?.(message);
        };

        this.ws.onerror = (event) => {
          this.options.onError?.(event);
          reject(event);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= (this.options.maxReconnectAttempts ?? 5)) {
      return;
    }

    this.reconnectAttempts++;
    setTimeout(() => {
      this.connect().catch(() => {
        // Reconnect failed, will try again if attempts remaining
      });
    }, this.options.reconnectInterval);
  }

  /**
   * Send a message
   */
  send(type: string, payload: unknown): void {
    const message: WebSocketMessage = { type, payload, timestamp: Date.now() };
    const data = JSON.stringify(message);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      // Queue message for when connection is ready
      this.messageQueue.push(data);
    }
  }

  /**
   * Send raw data
   */
  async sendRaw(data: string | ArrayBuffer | Blob): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (data instanceof Blob) {
        this.ws.send(await data.arrayBuffer());
      } else {
        this.ws.send(data);
      }
    }
  }

  /**
   * Close the connection
   */
  close(code = 1000, reason = 'Client closing'): void {
    this.shouldReconnect = false;
    this.ws?.close(code, reason);
  }

  /**
   * Check if connected
   */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get ready state
   */
  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }
}

// ============= Pub/Sub Helpers =============

export class PubSub {
  private channels: Map<string, Set<(message: unknown) => void>> = new Map();

  /**
   * Subscribe to a channel
   */
  subscribe(channel: string, callback: (message: unknown) => void): () => void {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    
    this.channels.get(channel)!.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.channels.get(channel)?.delete(callback);
    };
  }

  /**
   * Publish to a channel
   */
  publish(channel: string, message: unknown): void {
    const subscribers = this.channels.get(channel);
    if (subscribers) {
      for (const callback of subscribers) {
        callback(message);
      }
    }
  }

  /**
   * Get channel subscriber count
   */
  subscriberCount(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }

  /**
   * Clear all subscribers from a channel
   */
  clearChannel(channel: string): void {
    this.channels.delete(channel);
  }

  /**
   * Clear all channels
   */
  clear(): void {
    this.channels.clear();
  }
}

// ============= Factory Functions =============

/**
 * Create a WebSocket server
 */
export function createWebSocketServer(options?: WebSocketServerOptions): WebSocketServer {
  return new WebSocketServer(options);
}

/**
 * Create a WebSocket client
 */
export function createWebSocketClient(options: WebSocketClientOptions): WebSocketClient {
  return new WebSocketClient(options);
}

/**
 * Create a pub/sub instance
 */
export function createPubSub(): PubSub {
  return new PubSub();
}

// ============= Upgrade Helper =============

/**
 * Check if request is a WebSocket upgrade request
 */
export function isWebSocketRequest(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

/**
 * Generate WebSocket connection ID
 */
export function generateConnectionId(): string {
  return crypto.randomUUID();
}

/**
 * Create WebSocket data for new connection
 */
export function createWebSocketData(data?: Partial<WebSocketData>): WebSocketData {
  return {
    id: generateConnectionId(),
    ...data,
  };
}
