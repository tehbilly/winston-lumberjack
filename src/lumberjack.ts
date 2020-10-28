import { createWriteStream, existsSync } from 'fs';
import { mkdir, readdir, rename, rm, stat } from 'fs/promises';
import { EOL } from 'os';
import { basename, dirname, extname, join, resolve } from 'path';
import { LogEntry } from 'winston';
import Transport from 'winston-transport';
import WritableStream = NodeJS.WritableStream;

const { MESSAGE } = require('triple-beam');

export interface LumberjackOptions extends Transport.TransportStreamOptions {
  fileName: string;
  maxSize: string | number;
  maxBackups: number;
}

export class Lumberjack extends Transport {
  protected fileName: string;
  protected maxSize: number;
  protected maxBackups: number;
  public level?: string = 'info';

  protected output?: WritableStream;
  protected currentSize: number = 0;

  constructor(opts: LumberjackOptions) {
    super(opts as Transport.TransportStreamOptions);

    // Validate options
    if (opts.fileName.length === 0) {
      throw new Error('Lumberjack requires a filename');
    }

    this.fileName = resolve(opts.fileName);
    switch (typeof opts.maxSize) {
      case 'number':
        this.maxSize = opts.maxSize;
        break;
      case 'string':
        this.maxSize = Lumberjack.parseSizeString(opts.maxSize as string);
        break;
    }
    this.maxBackups = opts.maxBackups;
  }

  private static parseSizeString(ss: string): number {
    const sp = ss.toLowerCase().match(/^((?:0\.)?\d+)([kmg])$/);
    if (!sp) {
      throw new Error('Size string is not valid. Valid example: 5M or 5m');
    }

    const sn = parseInt(sp[1]);

    switch (sp[2]) {
      case 'k':
        return sn * 1024;
      case 'm':
        return sn * 1024 * 1024;
      case 'g':
        return sn * 1024 * 1024 * 1024;
    }

    throw new Error('Invalid size identifier. Valid identifiers are: k,m,g');
  }

  public async log(info: LogEntry, callback?: () => void): Promise<any> {
    setImmediate(() => {
      this.emit('logged', info);
    });

    // Ensure our log file and stream exist
    await this.initLogFile();

    // Rotate our file if it's met our threshold
    await this.rotate();

    // Remove old files if we're over the limit
    await this.removeExpired();

    this.output?.write(info[MESSAGE] + EOL);

    if (callback) {
      callback();
    }
  }

  public async close(): Promise<void> {
    this.output?.end();
  }

  private openWriteStream() {
    this.output = createWriteStream(this.fileName, { flags: 'a' });
    this.output.on('data', data => {
      this.currentSize += data.length;
    });
  }

  private async initLogFile() {
    if (this.output === undefined) {
      // Create directory if it doesn't exist
      if (!existsSync(dirname(this.fileName))) {
        await mkdir(dirname(this.fileName), { recursive: true });
      }

      try {
        this.currentSize = (await stat(this.fileName)).size;
      } catch (e) {
        console.error(`Unable to get current size of file:`, e);
      }
      this.openWriteStream();
    }
  }

  private async rotate() {
    if (this.currentSize >= this.maxSize) {
      const ext = extname(this.fileName);
      const base = basename(this.fileName).replace(new RegExp(`${ext}$`), '');
      const newName = `${base}-${new Date().toISOString().replace(/:/g, '-')}${ext}`;

      this.output?.end();
      await rename(this.fileName, join(dirname(this.fileName), newName));

      this.currentSize = 0;
      this.openWriteStream();
    }
  }

  private async removeExpired() {
    const dir = dirname(this.fileName);
    const ext = extname(this.fileName);
    const base = basename(this.fileName).replace(new RegExp(`${ext}$`), '');

    let archives: Array<{ path: string, date: Date }> = new Array<{ path: string, date: Date }>();

    for (let f of await readdir(dirname(this.fileName))) {
      if (f.startsWith(base + '-') && f.endsWith(ext)) {
        let ds = f.substring(base.length + 1, (f.length - ext.length)).replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3');
        let date: Date;
        try {
          date = new Date(Date.parse(ds));
        } catch (e: any) {
          continue; // Error parsing date? Better to be safe and leave the file alone.
        }
        archives.push({ path: join(dir, f), date });
      }
    }

    if (archives.length <= this.maxBackups) return;

    // Sort so that the newest ones are at the beginning of the array
    archives.sort((a, b) => b.date.valueOf() - a.date.valueOf());

    for (let i = 0; i < archives.length; i++) {
      // These are the files we want to keep
      if (i < this.maxBackups) continue;

      try {
        await rm(archives[i].path);
      } catch (e: any) {
        // Ignoring errors removing files. We should probably report these somewhere.
      }
    }
  }
}
