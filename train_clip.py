import argparse
from datasets import load_dataset
from PIL import Image

import open_clip
from torch.utils.data import Dataset, DataLoader


class LookBenchDataset(Dataset):
    def __init__(self, split, config, preprocess, tokenizer):
        self.ds = load_dataset("srpone/look-bench", config)[split]
        self.preprocess = preprocess
        self.tokenizer = tokenizer

    def __len__(self):
        return len(self.ds)

    def __getitem__(self, idx):
        sample = self.ds[idx]
        img = sample['image']
        if not isinstance(img, Image.Image):
            img = Image.open(img).convert('RGB')
        pixel = self.preprocess(img)
        # build caption from available text fields
        caption_parts = []
        for k in ('main_attribute', 'other_attributes', 'category'):
            v = sample.get(k)
            if v and isinstance(v, str) and v.strip():
                caption_parts.append(v.strip())
        caption = '. '.join(caption_parts)
        if not caption:
            caption = sample.get('item_ID', '')
        return pixel, caption


def collate_fn(batch):
    import torch
    pixels = torch.stack([b[0] for b in batch])
    texts = [b[1] for b in batch]
    return pixels, texts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', default='aigen_streetlook')
    parser.add_argument('--split', default='query')
    parser.add_argument('--batch_size', type=int, default=32)
    parser.add_argument('--num_workers', type=int, default=4)
    parser.add_argument('--dry_run', action='store_true')
    parser.add_argument('--model', default='ViT-B-32')
    parser.add_argument('--pretrained', default=None, help='pretrained identifier for open_clip, or None')
    args = parser.parse_args()

    model, _, preprocess = open_clip.create_model_and_transforms(args.model, pretrained=args.pretrained)
    tokenizer = open_clip.get_tokenizer('openai')

    dataset = LookBenchDataset(args.split, args.config, preprocess, tokenizer)
    loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=True, num_workers=args.num_workers, collate_fn=collate_fn)

    if args.dry_run:
        print('Dataset length:', len(dataset))
        batch = next(iter(loader))
        pixels, texts = batch
        print('Pixels shape:', getattr(pixels, 'shape', type(pixels)))
        print('Texts sample:', texts[:3])
        # tokenize texts
        tokens = open_clip.tokenize(texts)
        print('Tokenized shape:', tokens.shape)
        return

    # Placeholder for training loop (we'll implement next)
    print('Dry run disabled — training loop will be implemented next')


if __name__ == '__main__':
    main()
