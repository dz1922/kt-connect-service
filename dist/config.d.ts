import Conf from 'conf';
import { Config, ConnectionProfile } from './types';
declare const config: Conf<Config>;
export declare function getConfig(): Config;
export declare function setKtctlPath(ktctlPath: string): void;
export declare function getKtctlPath(): string | undefined;
export declare function getLogDir(): string;
export declare function getPidFile(): string;
export declare function addProfile(profile: ConnectionProfile): void;
export declare function getProfile(name: string): ConnectionProfile | undefined;
export declare function getAllProfiles(): ConnectionProfile[];
export declare function removeProfile(name: string): boolean;
export declare function updateProfile(name: string, updates: Partial<ConnectionProfile>): boolean;
export declare function setActiveProfile(name: string | undefined): void;
export declare function getActiveProfile(): string | undefined;
export declare function clearConfig(): void;
export default config;
//# sourceMappingURL=config.d.ts.map