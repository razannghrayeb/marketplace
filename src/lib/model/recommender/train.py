import argparse
import os
from pathlib import Path
import torch
from torch import nn, optim
from torch.utils.data import DataLoader
from tqdm import tqdm

from recommender.datasets import GenericFashionDataset, collate_fn
from recommender.model import RecommenderModel


class NTXentLoss(nn.Module):
    """Normalized temperature-scaled cross entropy loss (InfoNCE) for embeddings."""

    def __init__(self, temperature: float = 0.07):
        super().__init__()
        self.temperature = temperature
        self.cos = nn.CosineSimilarity(dim=2)

    def forward(self, embeddings, labels=None):
        # embeddings: [B, D]
        # For unsupervised, we rely on assumed positives via outfit ids handled in dataset + sampler.
        batch_size = embeddings.size(0)
        z = F.normalize(embeddings, p=2, dim=1)
        sim = torch.matmul(z, z.t()) / self.temperature  # [B, B]
        # Mask out diagonal
        mask = torch.eye(batch_size, device=embeddings.device).bool()
        sim_masked = sim.masked_fill(mask, -9e15)
        # Create labels: treat i->j highest similarity as positive? Simple approach: use rowwise softmax and self-contrast
        logits = sim_masked
        labels = torch.arange(batch_size, device=embeddings.device)
        loss = nn.CrossEntropyLoss()(logits, labels)
        return loss


def train(args):
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    Path(args.output_dir).mkdir(parents=True, exist_ok=True)

    # Dataset
    ds = GenericFashionDataset(args.csv, image_root=args.image_root)
    num_attributes = len(ds.label_vocab)
    print(f"Dataset size: {len(ds)}, num_attributes: {num_attributes}")

    dl = DataLoader(ds, batch_size=args.batch_size, shuffle=True, collate_fn=collate_fn, num_workers=4)

    model = RecommenderModel(num_attributes=num_attributes, embedding_dim=args.embedding_dim)
    model.to(device)

    bce = nn.BCEWithLogitsLoss()
    ntx = NTXentLoss(temperature=args.temperature)

    optimizer = optim.Adam(model.parameters(), lr=args.lr)

    for epoch in range(1, args.epochs + 1):
        model.train()
        pbar = tqdm(dl, desc=f"Epoch {epoch}")
        total_loss = 0.0
        for imgs, labels, outfit_ids in pbar:
            imgs = imgs.to(device)
            labels = labels.to(device)

            optimizer.zero_grad()
            emb, logits = model(imgs)

            # Attribute loss
            if labels.numel() > 0:
                attr_loss = bce(logits, labels)
            else:
                attr_loss = torch.tensor(0.0, device=device)

            # Embedding loss (placeholder: use NTXent on batch)
            emb_loss = ntx(emb, labels=None)

            loss = args.alpha * attr_loss + args.beta * emb_loss
            loss.backward()
            optimizer.step()

            total_loss += loss.item()
            pbar.set_postfix({'loss': f"{total_loss / (pbar.n or 1):.4f}"})

        # Save checkpoint
        ckpt = Path(args.output_dir) / f"model_epoch{epoch}.pt"
        torch.save({
            'model_state': model.state_dict(),
            'label_vocab': ds.label_vocab
        }, ckpt)
        print(f"Saved checkpoint: {ckpt}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--csv', required=True, help='CSV with image_path and labels')
    parser.add_argument('--image-root', default='.', help='Root dir for image paths')
    parser.add_argument('--output-dir', default='models/recommender', help='Where to save checkpoints')
    parser.add_argument('--batch-size', type=int, default=32)
    parser.add_argument('--epochs', type=int, default=10)
    parser.add_argument('--lr', type=float, default=1e-4)
    parser.add_argument('--embedding-dim', type=int, default=256)
    parser.add_argument('--alpha', type=float, default=1.0, help='weight for attribute loss')
    parser.add_argument('--beta', type=float, default=1.0, help='weight for embedding loss')
    parser.add_argument('--temperature', type=float, default=0.07)
    args = parser.parse_args()
    train(args)
