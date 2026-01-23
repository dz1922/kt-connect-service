// Default values
export const DEFAULT_IMAGE = 'registry.cn-hangzhou.aliyuncs.com/rdc-incubator/kt-connect-shadow';
export const DEFAULT_NAMESPACE = 'default';
export const DEFAULT_DESCRIPTION = 'default';

export interface ConnectionProfile {
  name: string;
  image: string;
  namespace?: string;
  kubeconfig?: string;
  extraArgs?: string[];
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceStatus {
  running: boolean;
  pid?: number;
  profile?: string;
  namespace?: string;
  startedAt?: string;
  logFile?: string;
}

export interface Config {
  profiles: Record<string, ConnectionProfile>;
  activeProfile?: string;
  ktctlPath?: string;
  logDir: string;
  pidFile: string;
}

export interface InstallOptions {
  version?: string;
  installPath?: string;
  force?: boolean;
}

export interface ConnectOptions {
  profile?: string;
  namespace?: string;
  background?: boolean;
}
