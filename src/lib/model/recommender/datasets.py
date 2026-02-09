from pathlib import Path
from typing import List, Optional, Tuple, Dict
import pandas as pd
from PIL import Image
import torch
from torch.utils.data import Dataset
from torchvision import transforms


class GenericFashionDataset(Dataset):
    """Generic dataset that supports multi-label attributes and optional outfit grouping.

    Expected CSV columns:
      - image_path: local path to image file
      - labels: semicolon-separated attribute labels (optional)
      - outfit_id: id to indicate items in same outfit (optional)

    This class will build a label vocabulary from CSV and return (image, label_tensor, outfit_id)
    """

    def __init__(self, csv_path: str, image_root: str = '', transform=None, label_vocab: Optional[Dict[str, int]] = None):
        self.df = pd.read_csv(csv_path)
        self.image_root = Path(image_root)
        self.transform = transform or transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])

        # Build or accept label vocab
        self.label_vocab = label_vocab or {}
        if 'labels' in self.df.columns and not label_vocab:
            self._build_label_vocab()

    def _build_label_vocab(self):
        all_labels = set()
        for v in self.df['labels'].fillna(''):
            for lab in v.split(';'):
                lab = lab.strip()
                if lab:
                    all_labels.add(lab)
        self.label_vocab = {l: i for i, l in enumerate(sorted(all_labels))}

    def __len__(self):
        return len(self.df)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor, Optional[int]]:
        row = self.df.iloc[idx]
        img_path = row.get('image_path')
        if not img_path:
            raise FileNotFoundError(f"Missing image_path for row {idx}")

        img_full = self.image_root / img_path if self.image_root and not Path(img_path).is_absolute() else Path(img_path)
        img = Image.open(img_full).convert('RGB')
        img = self.transform(img)

        # Multi-label vector
        if 'labels' in self.df.columns:
            labs = row['labels'] if pd.notna(row['labels']) else ''
            vec = torch.zeros(len(self.label_vocab), dtype=torch.float32)
            for lab in labs.split(';'):
                lab = lab.strip()
                if not lab:
                    continue
                if lab in self.label_vocab:
                    vec[self.label_vocab[lab]] = 1.0
            label_tensor = vec
        else:
            label_tensor = torch.zeros(0)

        outfit_id = int(row['outfit_id']) if 'outfit_id' in self.df.columns and pd.notna(row['outfit_id']) else None

        return img, label_tensor, outfit_id


def collate_fn(batch):
    images = torch.stack([b[0] for b in batch], dim=0)
    labels = [b[1] for b in batch]
    if labels and labels[0].numel() > 0:
        labels = torch.stack(labels, dim=0)
    else:
        labels = torch.zeros((images.size(0), 0))
    outfit_ids = [b[2] for b in batch]
    return images, labels, outfit_ids
