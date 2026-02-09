import argparse
from pathlib import Path
import torch
from torch.utils.data import DataLoader
from recommender.datasets import GenericFashionDataset, collate_fn
from recommender.model import RecommenderModel
import numpy as np
from sklearn.metrics import average_precision_score, f1_score


def compute_embeddings(model, dl, device):
    model.eval()
    embs = []
    labels = []
    outfit_ids = []
    with torch.no_grad():
        for imgs, lbls, oids in dl:
            imgs = imgs.to(device)
            emb, logits = model(imgs)
            embs.append(emb.cpu().numpy())
            labels.append(lbls.numpy() if lbls.numel() else np.zeros((imgs.size(0), 0)))
            outfit_ids.extend(oids)
    embs = np.concatenate(embs, axis=0)
    labels = np.concatenate(labels, axis=0) if len(labels) else np.zeros((embs.shape[0], 0))
    return embs, labels, outfit_ids


def recall_at_k(query_embs, gallery_embs, query_outfits, gallery_outfits, ks=(1,5,10)):
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ckpt', required=True)
    parser.add_argument('--csv', required=True)
    parser.add_argument('--image-root', default='.')
    parser.add_argument('--batch-size', type=int, default=64)
    args = parser.parse_args()

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

    ds = GenericFashionDataset(args.csv, image_root=args.image_root)
    dl = DataLoader(ds, batch_size=args.batch_size, collate_fn=collate_fn)

    model = RecommenderModel(num_attributes=len(ds.label_vocab))
    ckpt = torch.load(args.ckpt, map_location='cpu')
    model.load_state_dict(ckpt['model_state'])
    model.to(device)

    embs, labels, outfit_ids = compute_embeddings(model, dl, device)
    recalls = recall_at_k(embs, embs, outfit_ids, outfit_ids)
    print('Recall@k:', recalls)

    # Multi-label AP
    if labels.size:
        aps = []
        for i in range(labels.shape[1]):
            try:
                aps.append(average_precision_score(labels[:, i], (embs @ embs.T).diagonal()))
            except Exception:
                aps.append(0.0)
        print('mAP (approx):', np.mean(aps))

if __name__ == '__main__':
    main()
