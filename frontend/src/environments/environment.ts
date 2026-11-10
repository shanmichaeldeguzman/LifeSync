import { runtimeConfig } from './runtime-config';

export const environment = {
  production: false,
  ...runtimeConfig,
};
