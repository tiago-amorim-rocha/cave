/**
 * JSONL Logger for Headless Mode
 *
 * Writes structured logs to console and file in JSON Lines format.
 * Each log entry is a single-line JSON object for easy parsing.
 */

import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'info' | 'debug' | 'warn' | 'error' | 'data';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  data?: unknown;
}

export class JSONLLogger {
  private stream: fs.WriteStream;
  private logFile: string;
  private startTime: number;

  constructor(logDir: string = 'logs', logFileName: string = 'last-run.jsonl') {
    // Ensure log directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    this.logFile = path.join(logDir, logFileName);
    this.stream = fs.createWriteStream(this.logFile, { flags: 'w' });
    this.startTime = Date.now();

    this.info('Logger initialized', { logFile: this.logFile });
  }

  /**
   * Log a message with optional data
   */
  log(level: LogLevel, message: string, data?: unknown): void {
    const entry: LogEntry = {
      timestamp: Date.now() - this.startTime,
      level,
      message,
      ...(data !== undefined && { data })
    };

    const line = JSON.stringify(entry);

    // Write to console (for real-time monitoring)
    console.log(line);

    // Write to file
    this.stream.write(line + '\n');
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  /**
   * Log physics/game state data (most common use case)
   */
  data(message: string, data: unknown): void {
    this.log('data', message, data);
  }

  /**
   * Close the log file
   */
  close(): Promise<void> {
    return new Promise((resolve) => {
      // Write final message before closing
      const entry: LogEntry = {
        timestamp: Date.now() - this.startTime,
        level: 'info',
        message: 'Logger closing'
      };
      this.stream.write(JSON.stringify(entry) + '\n');

      this.stream.end(() => {
        resolve();
      });
    });
  }

  /**
   * Get the log file path
   */
  getLogPath(): string {
    return this.logFile;
  }
}
