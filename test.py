# Run this BEFORE any training!
from pathlib import Path
import yaml

# 1. Verify YAML structure
with open('data/deepfashion2_yolo.yaml') as f:
    config = yaml.safe_load(f)
    print(f"Classes: {config['nc']}")
    print(f"Names: {config['names']}")
    print(f"Train path: {config['train']}")
    print(f"Val path: {config['val']}")

# 2. Count images and labels
train_imgs = list(Path(config['path'] + '/images/train').glob('*.jpg'))
train_labels = list(Path(config['path'] + '/labels/train').glob('*.txt'))
val_imgs = list(Path(config['path'] + '/images/val').glob('*.jpg'))
val_labels = list(Path(config['path'] + '/labels/val').glob('*.txt'))

print(f"\nTrain: {len(train_imgs)} images, {len(train_labels)} labels")
print(f"Val: {len(val_imgs)} images, {len(val_labels)} labels")

# 3. Check label format and class distribution
import numpy as np
class_counts = np.zeros(config['nc'])
empty_labels = 0

for label_file in train_labels[:1000]:  # Sample 1000
    content = open(label_file).readlines()
    if len(content) == 0:
        empty_labels += 1
        continue
    for line in content:
        parts = line.strip().split()
        if len(parts) == 5:  # class x y w h
            cls = int(parts[0])
            if 0 <= cls < config['nc']:
                class_counts[cls] += 1

print(f"\n❌ Empty labels: {empty_labels} / 1000")
print(f"\n📊 Class distribution (first 1000):")
for i, count in enumerate(class_counts):
    print(f"  {config['names'][i]}: {int(count)} boxes")

# 4. Validate bbox coordinates
invalid_boxes = 0
for label_file in train_labels[:1000]:
    for line in open(label_file):
        parts = line.strip().split()
        if len(parts) == 5:
            _, x, y, w, h = map(float, parts)
            if not (0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1):
                invalid_boxes += 1

print(f"\n❌ Invalid boxes (coords > 1.0): {invalid_boxes} / sampled")