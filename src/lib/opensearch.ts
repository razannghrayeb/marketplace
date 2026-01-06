import { Client } from "@opensearch-project/opensearch";
import { config } from "../config";

export const osClient = new Client({
  node: config.opensearch.node,
});
