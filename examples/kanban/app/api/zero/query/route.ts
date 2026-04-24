import { mustGetQuery } from "@rocicorp/zero";
import { handleQueryRequest } from "@rocicorp/zero/server";

import { getZeroContext, queries } from "../../../../src/lib/zero";
import { schema } from "../../../../src/lib/zero-schema.gen";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const response = await handleQueryRequest(
    (name, args) =>
      mustGetQuery(queries, name).fn({ args, ctx: getZeroContext() }),
    schema,
    request,
  );

  return Response.json(response);
}
