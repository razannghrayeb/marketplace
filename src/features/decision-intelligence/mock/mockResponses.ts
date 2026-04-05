import { runCompareDecisionEngine } from "../engine/compareEngine";
import { mockProducts } from "./mockProducts";
import { mockDecisionRequests } from "./mockRequests";

export const mockDecisionResponses = mockDecisionRequests.map((request) =>
  runCompareDecisionEngine(
    mockProducts.filter((p) => request.productIds.includes(p.id)),
    request,
    { version: "mock" }
  )
);
