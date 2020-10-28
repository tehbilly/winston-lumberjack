import { test } from '@jest/globals';
import winston from 'winston';
import { Lumberjack } from './lumberjack';

test('accepts proper options', () => {
  // Empty filename throws error
  expect(() => new Lumberjack({
    fileName: '',
    maxSize: '5k',
    maxBackups: 2,
  })).toThrowError();

  // Creating a new instance doesn't throw an error when filename is not empty
  new Lumberjack({
    fileName: 'test.log',
    maxSize: '5k',
    maxBackups: 2,
  });
});

test('appends to log files', () => {
  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    defaultMeta: { service: 'user-service' },
    transports: [new Lumberjack({ fileName: './logs/test.log', maxSize: '5k', maxBackups: 2, format: winston.format.json() })],
  });

  for (let i = 0; i < 100; i++) {
    logger.log({
      level: 'info',
      message: `This is a rather long message. I don't want to have to write too many messages to get to the rollover limit'`,
    });
  }
});
