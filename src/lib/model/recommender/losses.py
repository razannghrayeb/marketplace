import torch
import torch.nn as nn
import torch.nn.functional as F


class SupervisedContrastiveLoss(nn.Module):
    """Supervised contrastive loss (Khosla et al.)

    Expects `features` shape [B, D] and `labels` shape [B] (outfit ids or class ids).
    If `labels` is None, falls back to self-supervised NT-Xent where positives are none (not ideal).
    """

    def __init__(self, temperature: float = 0.07):
        super().__init__()
        self.temperature = temperature

    def forward(self, features: torch.Tensor, labels: torch.Tensor):
        device = features.device
        features = F.normalize(features, p=2, dim=1)
        batch_size = features.shape[0]

        if labels is None:
            # Fallback: use identity (no positives) — produce zero loss
            return torch.tensor(0.0, device=device)

        # Compute similarity matrix
        sim = torch.matmul(features, features.t()) / self.temperature  # [B,B]

        # Build mask of positives: same label (exclude self)
        labels = labels.contiguous().view(-1, 1)
        mask = torch.eq(labels, labels.t()).float().to(device)
        # Exclude diagonal
        diag = torch.eye(batch_size, device=device)
        mask = mask - diag

        # For numerical stability, subtract max
        logits_max, _ = torch.max(sim, dim=1, keepdim=True)
        logits = sim - logits_max.detach()

        # Exponentiate
        exp_logits = torch.exp(logits) * (1 - diag)

        # For each anchor, denominator = sum over all non-diagonal exp_logits
        denom = exp_logits.sum(1, keepdim=True)

        # Numerator = sum over positives
        numerator = (exp_logits * mask).sum(1, keepdim=True)

        # Avoid divide-by-zero
        eps = 1e-8
        loss = -torch.log((numerator + eps) / (denom + eps))

        # Only consider anchors that have at least one positive
        valid = (mask.sum(1) > 0).float()
        loss = (loss.squeeze() * valid).sum() / (valid.sum() + eps)

        return loss
