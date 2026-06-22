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
  skipNodeModulesBundle: true,
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
