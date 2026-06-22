/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The @axiom/* workspace packages publish raw TypeScript (main → src/index.ts),
  // so Next must transpile them rather than expecting pre-built JS.
  transpilePackages: [
    '@axiom/shared-types',
    '@axiom/database',
    '@axiom/matching-engine',
    '@axiom/dynamodb-client',
  ],
  // `pg` and the AWS SDK are server-only native/Node deps; keep them external to
  // the bundle so they load from node_modules at runtime in the Node serverless
  // function (never pulled into the client or edge bundle).
  serverExternalPackages: ['pg', '@aws-sdk/dsql-signer'],
  webpack: (config) => {
    // The @axiom/* packages use NodeNext-style import specifiers (`./engine.js`
    // pointing at engine.ts). Webpack must resolve those .js specifiers to the
    // real .ts/.tsx sources. extensionAlias makes `import './x.js'` try
    // x.ts → x.tsx → x.js, which is exactly the NodeNext mapping.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
