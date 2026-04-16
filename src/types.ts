export const DEFAULT_IMAGE = 'registry.cn-hangzhou.aliyuncs.com/rdc-incubator/kt-connect-shadow';
export const DEFAULT_NAMESPACE = 'default';

export interface Defaults {
  image: string;
  namespace: string;
  kubeconfig?: string;
  extraArgs?: string[];
}

export interface ServiceStatus {
  running: boolean;
  pid?: number;
  context?: string;
  namespace?: string;
  startedAt?: string;
  logFile?: string;
}

export interface Config {
  defaults: Defaults;
  logDir: string;
  pidFile: string;
  ktctlPath?: string;
}

export interface ConnectOptions {
  context?: string;
  namespace?: string;
  image?: string;
  kubeconfig?: string;
}

export interface InstallOptions {
  version?: string;
  installPath?: string;
  force?: boolean;
  mirror?: boolean;
}
