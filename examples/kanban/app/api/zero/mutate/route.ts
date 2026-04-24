import { mustGetMutator } from "@rocicorp/zero";
import { handleMutateRequest } from "@rocicorp/zero/server";

import { getZeroDb } from "../../../../src/lib/db";
import { getZeroContext, mutators } from "../../../../src/lib/zero";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const response = await handleMutateRequest(
    getZeroDb(),
    async (transact) =>
      transact(async (tx, name, args) => {
        await mustGetMutator(mutators, name).fn({
          args,
          ctx: getZeroContext(),
          tx,
        });
      }),
    request,
  );

  return Response.json(response);
}
