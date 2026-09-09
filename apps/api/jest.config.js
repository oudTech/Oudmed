module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.(spec|int-spec)\\.ts$',
  // Integration specs share one docker Postgres; run serially with headroom.
  maxWorkers: 1,
  testTimeout: 30000,
};
