import { runtimeConfig } from './runtime-config';

export const environment = {
  production: true,
  ...runtimeConfig,
};
