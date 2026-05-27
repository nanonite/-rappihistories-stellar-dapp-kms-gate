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
COPY components/kms-gate/package.json components/kms-gate/package.json
COPY components/kms-gate/tsconfig.json components/kms-gate/tsconfig.json
COPY components/kms-gate/src components/kms-gate/src
RUN cd components/kms-gate && pnpm install --prod=false --registry "${NPM_CONFIG_REGISTRY}"
RUN cd components/kms-gate && pnpm build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/components/kms-gate/dist components/kms-gate/dist
CMD ["node", "components/kms-gate/dist/index.js"]
