import { InstallOptions } from './types';
export declare function getLatestVersion(): Promise<string>;
export declare function getDownloadUrl(version: string, useMirror?: boolean): string;
export declare function downloadFile(url: string, destPath: string, onProgress?: (percent: number, downloaded: number, total: number) => void): Promise<void>;
export declare function install(options?: InstallOptions): Promise<string>;
export declare function getInstalledVersion(ktctlPath?: string): string | null;
export declare function isKtctlInstalled(): boolean;
export declare function findKtctl(): string | null;
//# sourceMappingURL=installer.d.ts.map