import { createServer } from "node:http";

import {
  LocalKeyStore,
  ReleaseHttpApi,
  ReleasePredicateEvaluator,
} from "../dist/index.js";

const port = Number(process.env.KMS_GATE_PORT ?? "8790");

const api = new ReleaseHttpApi({
  evaluator: new ReleasePredicateEvaluator({
    async readGrant() {
      return null;
    },
  }),
  keyStore: new LocalKeyStore(),
});

const server = createServer(async (incoming, outgoing) => {
  try {
    if (incoming.url === "/v1/health") {
      writeResponse(
        outgoing,
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        }),
      );
      return;
    }

    const request = await toFetchRequest(incoming);
    const response = await api.fetch(request);
    writeResponse(outgoing, response);
  } catch (error) {
    console.error(error);
    writeResponse(
      outgoing,
      new Response(JSON.stringify({ error: "internal_error" }), {
        status: 500,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
  }
});

server.listen(port, "0.0.0.0", () => {
  console.info(`kms-gate listening on 0.0.0.0:${port}`);
});

async function toFetchRequest(incoming) {
  const origin = `http://${incoming.headers.host ?? `localhost:${port}`}`;
  const url = new URL(incoming.url ?? "/", origin);
  const method = incoming.method ?? "GET";
  const headers = new Headers();

  for (const [key, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const body = method === "GET" || method === "HEAD"
    ? undefined
    : Buffer.concat(await readBody(incoming));

  return new Request(url, {
    method,
    headers,
    body,
  });
}

function readBody(incoming) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    incoming.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    incoming.on("end", () => {
      resolve(chunks);
    });
    incoming.on("error", reject);
  });
}

function writeResponse(outgoing, response) {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, key) => {
    outgoing.setHeader(key, value);
  });

  response.arrayBuffer().then((body) => {
    outgoing.end(Buffer.from(body));
  });
}
