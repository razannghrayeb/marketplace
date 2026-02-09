import argparse
from pathlib import Path
import torch
from torch import nn, optim
from torch.utils.data import DataLoader
from tqdm import tqdm

from recommender.datasets import GenericFashionDataset, collate_fn
from recommender.model import RecommenderModel
from recommender.sampler import OutfitBatchSampler
from recommender.losses import SupervisedContrastiveLoss
from sklearn.metrics import f1_score, average_precision_score
import numpy as np


def evaluate_embeddings(model, dl, device):
    model.eval()
    embs = []
    ids = []
    labels = []
    with torch.no_grad():
        for imgs, lbls, outfit_ids in dl:
            imgs = imgs.to(device)
            emb, _ = model(imgs)
            embs.append(emb.cpu())
            ids.extend(outfit_ids)
            labels.append(lbls.cpu())
    embs = torch.cat(embs, dim=0).numpy()
    labels = torch.cat(labels, dim=0).numpy() if len(labels) and labels[0].size else np.zeros((embs.shape[0], 0))
    return embs, labels, ids


def compute_recall_at_k(query_embs, gallery_embs, query_outfits, gallery_outfits, ks=(1,5,10)):
    # brute-force distances
    from sklearn.metrics.pairwise import cosine_similarity
    sim = cosine_similarity(query_embs, gallery_embs)
    recalls = {}
    for k in ks:
        correct = 0
        for i in range(sim.shape[0]):
            topk = np.argsort(-sim[i])[:k]
            q_oid = query_outfits[i]
            found = any(gallery_outfits[j] == q_oid for j in topk)
            if found:
                correct += 1
        recalls[k] = correct / sim.shape[0]
    return recalls


def train(args):
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    Path(args.output_dir).mkdir(parents=True, exist_ok=True)

    ds = GenericFashionDataset(args.csv, image_root=args.image_root)
    num_attributes = len(ds.label_vocab)
    print(f"Dataset size: {len(ds)}, num_attributes: {num_attributes}")

    # Sampler: ensure batches include items sharing outfit_id
    sampler = OutfitBatchSampler(ds, outfits_per_batch=args.outfits_per_batch, items_per_outfit=args.items_per_outfit, drop_last=False)
    dl = DataLoader(ds, batch_sampler=sampler, collate_fn=collate_fn, num_workers=4)

    model = RecommenderModel(num_attributes=num_attributes, embedding_dim=args.embedding_dim)
    model.to(device)

    bce = nn.BCEWithLogitsLoss()
    scl = SupervisedContrastiveLoss(temperature=args.temperature)

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
            if labels.numel() > 0 and labels.size(1) > 0:
                attr_loss = bce(logits, labels)
            else:
                attr_loss = torch.tensor(0.0, device=device)

            # Prepare outfit labels for contrastive loss
            if outfit_ids and any(oid is not None for oid in outfit_ids):
                # Map outfit ids to integers, using -1 for None
                outfit_map = {}
                mapped = []
                next_i = 0
                for oid in outfit_ids:
                    if oid is None:
                        mapped.append(-1)
                    else:
                        if oid not in outfit_map:
                            outfit_map[oid] = next_i
                            next_i += 1
                        mapped.append(outfit_map[oid])
                labels_tensor = torch.tensor(mapped, device=device)
            else:
                labels_tensor = None

            emb_loss = scl(emb, labels_tensor)

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

        # Optional evaluation on a small holdout
        if args.val_csv:
            val_ds = GenericFashionDataset(args.val_csv, image_root=args.image_root, label_vocab=ds.label_vocab)
            val_dl = DataLoader(val_ds, batch_size=args.eval_batch_size, collate_fn=collate_fn)
            q_embs, q_labels, q_outfits = evaluate_embeddings(model, val_dl, device)
            # Use same set as gallery for simplicity
            recalls = compute_recall_at_k(q_embs, q_embs, q_outfits, q_outfits)
            print(f"Validation recall: {recalls}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--csv', required=True)
    parser.add_argument('--val-csv', default=None)
    parser.add_argument('--image-root', default='.')
    parser.add_argument('--output-dir', default='models/recommender')
    parser.add_argument('--batch-size', type=int, default=32)
    parser.add_argument('--outfits-per-batch', type=int, default=8)
    parser.add_argument('--items-per-outfit', type=int, default=4)
    parser.add_argument('--epochs', type=int, default=10)
    parser.add_argument('--lr', type=float, default=1e-4)
    parser.add_argument('--embedding-dim', type=int, default=256)
    parser.add_argument('--alpha', type=float, default=1.0)
    parser.add_argument('--beta', type=float, default=1.0)
    parser.add_argument('--temperature', type=float, default=0.07)
    parser.add_argument('--eval-batch-size', type=int, default=64)
    args = parser.parse_args()
    train(args)
