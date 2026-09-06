import { handleSimulationShareRequest } from "../../_shared/share_api.js";

export async function onRequestGet({ request, params, env }) {
  return handleSimulationShareRequest({ request, params, env, locale: params?.locale });
}
