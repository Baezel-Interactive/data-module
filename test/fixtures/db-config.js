export const dbOptions = {
  driver: 'postgres',
  config: { host: 'localhost', database: 'app' },
  provisioning: { createIfMissing: false },
};
