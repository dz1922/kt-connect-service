import { ServiceStatus, ConnectOptions } from './types';
export declare function getStatus(): ServiceStatus;
export declare function connect(options?: ConnectOptions): Promise<void>;
export declare function disconnect(): Promise<void>;
export declare function cleanup(): Promise<void>;
export declare function getLogs(lines?: number): string;
export declare function switchNamespace(namespace: string): void;
//# sourceMappingURL=connection.d.ts.map