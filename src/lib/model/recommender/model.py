import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import models


class RecommenderModel(nn.Module):
    """ResNet backbone with multi-label attribute head and embedding head."""

    def __init__(self, num_attributes: int, embedding_dim: int = 256, backbone_name: str = 'resnet50', pretrained: bool = True):
        super().__init__()
        # Load backbone
        if backbone_name == 'resnet50':
            backbone = models.resnet50(pretrained=pretrained)
            feat_dim = backbone.fc.in_features
            # remove fc
            backbone.fc = nn.Identity()
        else:
            raise ValueError('Unsupported backbone')

        self.backbone = backbone
        self.feat_dim = feat_dim

        # Embedding head
        self.embedding_head = nn.Sequential(
            nn.Linear(self.feat_dim, 512),
            nn.ReLU(inplace=True),
            nn.Linear(512, embedding_dim)
        )

        # Attribute multi-label head
        self.attr_head = nn.Sequential(
            nn.Linear(self.feat_dim, 512),
            nn.ReLU(inplace=True),
            nn.Dropout(0.3),
            nn.Linear(512, num_attributes)
        )

    def forward(self, x):
        feats = self.backbone(x)  # [B, feat_dim]
        emb = self.embedding_head(feats)
        emb = F.normalize(emb, p=2, dim=1)
        logits = self.attr_head(feats)
        return emb, logits
