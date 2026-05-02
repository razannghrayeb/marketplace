import { tieredColorListCompliance } from "../../lib/color/colorCanonical";

export function computeColorContradictionPenalty(params: {
  desiredColorsTier: string[];
  rerankColorMode: "any" | "all";
  hasExplicitColorIntent: boolean;
  hasInferredColorSignal: boolean;
  hasCropColorSignal: boolean;
  rawVisual: number;
  nearIdenticalRawMin: number;
  docColors: string[];
  bucketOnlyConflict: boolean;
}): number {
  if (!Array.isArray(params.desiredColorsTier) || params.desiredColorsTier.length === 0) return 1;
  if (!Array.isArray(params.docColors) || params.docColors.length === 0) return 1;

  const tier = tieredColorListCompliance(
    params.desiredColorsTier,
    params.docColors,
    params.rerankColorMode,
  );
  if ((tier?.compliance ?? 0) > 0 && !params.bucketOnlyConflict) return 1;

  if (params.bucketOnlyConflict) {
    if (params.rawVisual >= params.nearIdenticalRawMin) {
      if (params.hasExplicitColorIntent) return 0.9;
      if (params.hasInferredColorSignal) return 0.93;
      if (params.hasCropColorSignal) return 0.95;
      return 0.96;
    }
    if (params.hasExplicitColorIntent) return 0.8;
    if (params.hasInferredColorSignal) return 0.86;
    if (params.hasCropColorSignal) return 0.9;
    return 0.94;
  }

  // Hard color contradiction (different color family entirely, e.g. searching gray/black,
  // product is red/green). Keep the visual signal visible, but suppress it enough that
  // a correctly colored product can still outrank it.
  if (params.rawVisual >= params.nearIdenticalRawMin) {
    if (params.hasExplicitColorIntent) return 0.7;
    if (params.hasInferredColorSignal) return 0.8;
    if (params.hasCropColorSignal) return 0.9;
    return 1;
  }

  // Non-near-identical: still penalize but allow some visibility for visually similar items
  // that differ only in color (e.g. same style, different color family entirely).
  if (params.hasExplicitColorIntent) return 0.62;
  if (params.hasInferredColorSignal) return 0.74;
  if (params.hasCropColorSignal) return 0.88;
  return 1;
}
