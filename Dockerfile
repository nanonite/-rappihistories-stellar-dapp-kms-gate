# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=docker.io/library/node:22-bookworm

FROM ${NODE_IMAGE} AS base
WORKDIR /app

ENV COREPACK_ENABLE_PROJECT_SPEC=0
ARG NPM_CONFIG_REGISTRY=http://verdaccio:4873/
ENV NPM_CONFIG_REGISTRY=${NPM_CONFIG_REGISTRY}
ENV npm_config_registry=${NPM_CONFIG_REGISTRY}

RUN npm install --global pnpm@9.15.9 --registry "${NPM_CONFIG_REGISTRY}"

FROM base AS builder
COPY components/packages/domain components/packages/domain
COPY components/kms-gate/package.json components/kms-gate/package.json
COPY components/kms-gate/tsconfig.json components/kms-gate/tsconfig.json
COPY components/kms-gate/src components/kms-gate/src
RUN cd components/kms-gate && pnpm install --prod=false --config.auto-install-peers=false --registry "${NPM_CONFIG_REGISTRY}"
RUN cd components/packages/domain && /app/components/kms-gate/node_modules/.bin/tsc -b --pretty false
RUN mkdir -p components/kms-gate/node_modules/@medichain/domain && \
  cp -R components/packages/domain/dist components/kms-gate/node_modules/@medichain/domain/dist && \
  printf '%s\n' \
    '{' \
    '  "name": "@medichain/domain",' \
    '  "version": "0.1.0",' \
    '  "private": true,' \
    '  "type": "module",' \
    '  "main": "./dist/index.js",' \
    '  "types": "./dist/index.d.ts",' \
    '  "exports": {' \
    '    ".": {' \
    '      "types": "./dist/index.d.ts",' \
    '      "default": "./dist/index.js"' \
    '    }' \
    '  }' \
    '}' > components/kms-gate/node_modules/@medichain/domain/package.json
RUN cd components/kms-gate && pnpm build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV KMS_GATE_PORT=8790
COPY --from=builder /app/components/kms-gate/dist components/kms-gate/dist
COPY --from=builder /app/components/kms-gate/node_modules/@medichain/domain components/kms-gate/node_modules/@medichain/domain
COPY components/kms-gate/runtime components/kms-gate/runtime
EXPOSE 8790
CMD ["node", "components/kms-gate/runtime/server.mjs"]
