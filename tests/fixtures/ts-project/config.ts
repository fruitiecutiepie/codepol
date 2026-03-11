export const VERSION = '1.0.0';
export const DEBUG = true;
export const MAX_RETRIES = 5;
export const TIMEOUT_MS = 3000;
export const APP_NAME = 'myapp';
export const DEFAULT_PORT = 8080;
export const LOG_LEVEL = 'INFO';
export const ENABLE_CACHE = false;
export const SECRET_KEY = 'change-me';
export const DATABASE_URL = 'sqlite:///db.sqlite3';

export type AppEnv = 'development' | 'staging' | 'production';

export enum LogLevel {
  Debug = 'debug',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
}
