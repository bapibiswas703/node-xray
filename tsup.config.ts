import { defineConfig, type Options } from 'tsup';

const baseConfig: Options = {
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node18',
  platform: 'node',
  splitting: false,
  treeshake: true,
  minify: false,
  // Do NOT use `skipNodeModulesBundle`: it makes tsup bundle anything
  // matched by tsconfig `paths` BEFORE consulting `external`, which
  // inlined a private copy of @node-xray/core (its own ALS instance and
  // event bus, plus an undeclared `require('ws')`) into every adapter
  // dist. Without it, tsup externalizes each package's declared
  // `dependencies`/`peerDependencies`; the explicit list below is a
  // belt-and-braces guard for the workspace packages and core's one
  // runtime dep.
  external: [
    '@node-xray/types',
    '@node-xray/core',
    '@node-xray/dashboard',
    '@node-xray/express',
    '@node-xray/fastify',
    '@node-xray/nestjs',
    'ws',
  ],
  outExtension: ({ format }) => ({
    js: format === 'cjs' ? '.cjs' : '.js',
  }),
  output: {
    exports: 'named',
  },
};

export default defineConfig((envOptions) => {
  const isWatch = envOptions.watch === true;
  return [
    {
      ...baseConfig,
      entry: ['src/index.ts'],
      outExtension: ({ format }) => ({
        js: format === 'cjs' ? '.cjs' : '.js',
      }),
      watch: isWatch,
    },
  ];
});
